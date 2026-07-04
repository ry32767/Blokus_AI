import { ACTION_SIZE, PASS_ACTION, applyMove, encodeAction, generateLegalMoves, scoreState } from "../../../../packages/core/src/index.js";
import { chooseEndgameAlphaBetaMove, chooseExactEndgameMove } from "./alphaBetaAi.js";
import { evaluateMoveQuick, evaluateState } from "./evaluation.js";
import { chooseExpertMove } from "./expertAi.js";
import { inferPolicyValue, now } from "./modelRunner.js";
import { resolveRng, scoredDescending } from "./random.js";
import { TranspositionTable, hashState, totalLegalPlacements, totalRemainingPieces } from "./transpositionTable.js";

function normalizeValue(scoreDiff) {
  return Math.max(-1, Math.min(1, scoreDiff / 89));
}

// Terminal leaf value in the negamax convention. `advanceTurnOrFinish` does not
// toggle `currentPlayer` when the game ends, so at a terminal state
// `state.currentPlayer` is the player who made the final move — the same side
// to move at the parent node. backup() negates once per ply, so the leaf must
// report the value from the opponent-of-mover perspective (the notional side
// to move at the leaf) for the parent to read the score correctly.
export function finalValueForToMove(state) {
  const [scoreA, scoreB] = scoreState(state);
  return normalizeValue(state.currentPlayer === 0 ? scoreB - scoreA : scoreA - scoreB);
}

function rankByPolicy(logits, moves, rng) {
  const scored = scoredDescending(
    moves,
    (move) => Number(logits[encodeAction(move)] ?? Number.NEGATIVE_INFINITY),
    rng,
  ).map(({ item: move, score }) => ({
    move,
    action: encodeAction(move),
    prior: score,
  }));
  const maxLogit = scored[0]?.prior ?? 0;
  const weights = scored.map((entry) => Math.exp(entry.prior - maxLogit));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return scored.map((entry, index) => ({
    ...entry,
    prior: weights[index] / total,
  }));
}

// After truncating to `candidateLimit`, the kept priors sum to < 1, which would
// globally shrink the PUCT exploration term (and distort the Dirichlet mixture).
// Renormalize so the kept children form a proper distribution.
function renormalizePriors(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.prior, 0);
  if (!(total > 0)) {
    const uniform = entries.length > 0 ? 1 / entries.length : 0;
    return entries.map((entry) => ({ ...entry, prior: uniform }));
  }
  return entries.map((entry) => ({ ...entry, prior: entry.prior / total }));
}

// --- Seeded sampling helpers (Dirichlet root noise + temperature move sampling) ---

function sampleNormal(rng) {
  let u1 = rng();
  const u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleGamma(alpha, rng) {
  if (alpha < 1) {
    const u = Math.max(rng(), 1e-12);
    return sampleGamma(alpha + 1, rng) * Math.pow(u, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Marsaglia & Tsang; bounded retries keep it deterministic and terminating.
  for (let i = 0; i < 64; i += 1) {
    const x = sampleNormal(rng);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = Math.max(rng(), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v;
    }
  }
  return d;
}

function sampleDirichlet(count, alpha, rng) {
  const draws = [];
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const g = sampleGamma(alpha, rng);
    draws.push(g);
    total += g;
  }
  if (total <= 0) return draws.map(() => 1 / count);
  return draws.map((value) => value / total);
}

// --- Tree nodes (lazy child state) ---
// Convention (negamax): node.valueSum / node.visits is the average value from the
// perspective of the player to move at that node. A leaf's network value is read
// in the to-move perspective and negated once per ply on the way up.

function createRoot(state) {
  return { move: null, action: null, prior: 0, state, visits: 0, valueSum: 0, children: null, terminalValue: null };
}

function createChild(move, action, prior) {
  return { move, action, prior, state: null, visits: 0, valueSum: 0, children: null, terminalValue: null };
}

function buildPolicyTargets(root, fallbackMove, rng) {
  const children = (root.children || []).filter((child) => child.move);
  const totalVisits = children.reduce((sum, child) => sum + child.visits, 0);
  if (totalVisits <= 0) {
    return {
      actions: [encodeAction(fallbackMove)],
      probs: [1],
      visits: [1],
      totalVisits: 1,
    };
  }

  const normalized = children
    .map((child) => ({
      action: encodeAction(child.move),
      visits: child.visits,
      prob: child.visits / totalVisits,
      tie: rng(),
    }))
    .sort((a, b) => (b.visits - a.visits) || (a.tie - b.tie));

  return {
    actions: normalized.map((entry) => entry.action),
    probs: normalized.map((entry) => Number(entry.prob.toFixed(6))),
    visits: normalized.map((entry) => entry.visits),
    totalVisits,
  };
}

function puctScore(parent, child, explorationC) {
  // child.Q is in the child's (opponent's) perspective; negate for the parent.
  const q = child.visits === 0 ? 0 : -(child.valueSum / child.visits);
  const u = explorationC * child.prior * Math.sqrt(parent.visits + 1) / (1 + child.visits);
  return q + u;
}

function selectChild(node, explorationC) {
  let best = node.children[0];
  let bestScore = -Infinity;
  for (const child of node.children) {
    const score = puctScore(node, child, explorationC);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  return best;
}

function backup(path, leafValue) {
  // leafValue is in the perspective of the player to move at the leaf.
  let value = leafValue;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    path[i].visits += 1;
    path[i].valueSum += value;
    value = -value;
  }
}

// Expand a leaf: returns the leaf value in the leaf's to-move perspective.
async function expandLeaf(node, config, table, counters, deps, rng) {
  if (node.state.status !== "playing") {
    node.children = [];
    node.terminalValue = finalValueForToMove(node.state);
    return node.terminalValue;
  }

  const candidateLimit = config.candidateLimit ?? 120;
  const hash = hashState(node.state);
  const cached = table.get(hash);
  if (cached && cached.kind === "nn") {
    counters.tableHits += 1;
    node.children = cached.ranked.map((entry) => createChild(entry.move, entry.action, entry.prior));
    return cached.value;
  }

  const moves = generateLegalMoves(node.state);
  const inference = await inferPolicyValue(node.state, node.state.currentPlayer, config, deps);
  if (!inference.logits || inference.logits.length !== ACTION_SIZE) {
    throw new Error(`Unexpected policy logits shape: ${inference.logits?.length ?? "none"}`);
  }
  const ranked = renormalizePriors(rankByPolicy(inference.logits, moves, rng).slice(0, candidateLimit));
  const value = inference.value; // already in node.state.currentPlayer (to-move) perspective
  table.set({ hash, kind: "nn", value, ranked });
  node.children = ranked.map((entry) => createChild(entry.move, entry.action, entry.prior));
  return value;
}

function applyRootNoise(root, config, rng) {
  const weight = config.rootDirichletWeight ?? 0;
  const alpha = config.rootDirichletAlpha ?? 0.3;
  if (!(weight > 0) || !root.children || root.children.length <= 1) return;
  const noise = sampleDirichlet(root.children.length, alpha, rng);
  root.children.forEach((child, index) => {
    child.prior = (1 - weight) * child.prior + weight * noise[index];
  });
}

function chooseFinalChild(root, config, rng) {
  const children = (root.children || []).filter((child) => child.visits > 0 || child.move);
  if (children.length === 0) return null;
  const temperature = config.moveSamplingTemperature ?? 0;
  const samplingPlies = config.moveSamplingPlies ?? 0;
  const useSampling = temperature > 0 && (root.state?.turn ?? Infinity) < samplingPlies;

  if (useSampling) {
    const weights = children.map((child) => Math.pow(Math.max(child.visits, 0), 1 / temperature));
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (total > 0) {
      let threshold = rng() * total;
      for (let i = 0; i < children.length; i += 1) {
        threshold -= weights[i];
        if (threshold <= 0) return children[i];
      }
      return children[children.length - 1];
    }
  }

  let best = children[0];
  for (const child of children) {
    if (child.visits > best.visits || (child.visits === best.visits && rng() < 0.5)) {
      best = child;
    }
  }
  return best;
}

export function isMasterEndgameSearchable(state) {
  return totalLegalPlacements(state) <= 220 || totalRemainingPieces(state) <= 6;
}

export function isMasterExactSolvable(state) {
  return totalLegalPlacements(state) <= 80 && totalRemainingPieces(state) <= 4;
}

export async function choosePolicyValueMctsMove(state, config = {}, deps = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 2500;
  const maxSimulations = config.simulations ?? config.maxSimulations ?? Infinity;
  const explorationC = config.explorationC ?? 1.5;
  const table = config.table ?? new TranspositionTable();
  const counters = { simulations: 0, nodes: 1, tableHits: 0 };
  const rng = resolveRng(config);

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: config.difficulty ?? "master",
        engine: "policy_value_mcts",
        strategy: "pass",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: PASS_ACTION,
        simulations: 0,
        nodes: 1,
        tableHits: 0,
      },
    };
  }

  const root = createRoot(state);
  // Expand the root once (NN inference may throw here; let it propagate to the
  // master wrapper so a broken model surfaces as an explicit fallback).
  const rootValue = await expandLeaf(root, config, table, counters, deps, rng);
  applyRootNoise(root, config, rng);

  while (now() - startedAt < timeLimitMs && counters.simulations < maxSimulations) {
    const path = [root];
    let node = root;
    while (node.children !== null && node.children.length > 0) {
      const child = selectChild(node, explorationC);
      if (child.state === null) {
        child.state = applyMove(node.state, child.move);
        counters.nodes += 1;
      }
      node = child;
      path.push(node);
    }

    let value;
    if (node.children !== null && node.children.length === 0) {
      // Re-selected terminal leaf.
      value = node.terminalValue ?? finalValueForToMove(node.state);
    } else {
      try {
        value = await expandLeaf(node, config, table, counters, deps, rng);
      } catch (error) {
        if ((error?.message || "").includes("Unexpected")) throw error;
        // Non-shape inference hiccup on a deep leaf: fall back to a heuristic estimate
        // in the leaf's own perspective rather than aborting the whole search.
        value = Math.max(-1, Math.min(1, evaluateState(node.state, node.state.currentPlayer) / 100));
        node.children = [];
        node.terminalValue = value;
      }
    }
    backup(path, value);
    counters.simulations += 1;
  }

  const bestChild = chooseFinalChild(root, config, rng);
  const bestMove = bestChild?.move ?? legalMoves[0];
  const policyTargets = buildPolicyTargets(root, bestMove, rng);
  const rootQ = root.visits > 0 ? root.valueSum / root.visits : rootValue;

  return {
    move: bestMove,
    stats: {
      difficulty: config.difficulty ?? "master",
      engine: "policy_value_mcts",
      strategy: "policy_value_mcts",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: encodeAction(bestMove),
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      simulations: counters.simulations,
      nodes: counters.nodes,
      tableHits: counters.tableHits,
      value: Number(rootQ.toFixed(3)),
      rootValue: Number(rootValue.toFixed(3)),
      policyTargetActions: policyTargets.actions,
      policyTargetProbs: policyTargets.probs,
      policyTargetVisits: policyTargets.visits,
      policyTargetTotalVisits: policyTargets.totalVisits,
    },
  };
}

export async function chooseMasterMove(state, config = {}, deps = {}) {
  const table = config.table ?? new TranspositionTable();
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 2500;

  try {
    if (isMasterExactSolvable(state)) {
      const decision = await chooseExactEndgameMove(state, {
        ...config,
        difficulty: "master",
        timeLimitMs,
        table,
      });
      return {
        ...decision,
        stats: { ...decision.stats, difficulty: "master", engine: "master", strategy: "exact" },
      };
    }

    if (isMasterEndgameSearchable(state)) {
      const decision = await chooseEndgameAlphaBetaMove(state, {
        ...config,
        difficulty: "master",
        timeLimitMs,
        maxDepth: config.maxDepth ?? 8,
        table,
      });
      return {
        ...decision,
        stats: { ...decision.stats, difficulty: "master", engine: "master", strategy: "alpha_beta" },
      };
    }

    const decision = await choosePolicyValueMctsMove(state, {
      ...config,
      difficulty: "master",
      timeLimitMs,
      candidateLimit: config.candidateLimit ?? 120,
      explorationC: config.explorationC ?? 1.5,
      table,
    }, deps);
    return {
      ...decision,
      stats: { ...decision.stats, difficulty: "master", engine: "master", strategy: "policy_value_mcts" },
    };
  } catch (error) {
    const fallback = await chooseExpertMove(state, {
      ...config,
      difficulty: "master",
      timeLimitMs: Math.min(timeLimitMs, 1200),
      maxThinkingMs: Math.min(timeLimitMs, 1200),
      table,
    });
    return {
      ...fallback,
      stats: {
        ...fallback.stats,
        difficulty: "master",
        engine: "master_fallback",
        strategy: "expert_fallback",
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
