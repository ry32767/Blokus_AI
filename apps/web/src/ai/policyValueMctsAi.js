import { ACTION_SIZE, PASS_ACTION, applyMove, encodeAction, generateLegalMoves, scoreState } from "../../../../packages/core/src/index.js";
import { chooseEndgameAlphaBetaMove, chooseExactEndgameMove } from "./alphaBetaAi.js";
import { evaluateMoveQuick, evaluateState } from "./evaluation.js";
import { chooseExpertMove } from "./expertAi.js";
import { inferPolicyValue, now } from "./modelRunner.js";
import { TranspositionTable, hashState, totalLegalPlacements, totalRemainingPieces } from "./transpositionTable.js";

function normalizeValue(scoreDiff) {
  return Math.max(-1, Math.min(1, scoreDiff / 89));
}

function finalValueFor(state, player) {
  const [scoreA, scoreB] = scoreState(state);
  return normalizeValue(player === 0 ? scoreA - scoreB : scoreB - scoreA);
}

function rankByPolicy(logits, moves) {
  const scored = moves.map((move) => ({
    move,
    action: encodeAction(move),
    prior: Number(logits[encodeAction(move)] ?? Number.NEGATIVE_INFINITY),
  }));
  scored.sort((a, b) => b.prior - a.prior);
  const top = scored.slice(0, Math.max(1, scored.length));
  const maxLogit = top[0]?.prior ?? 0;
  const weights = top.map((entry) => Math.exp(entry.prior - maxLogit));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  return top.map((entry, index) => ({
    ...entry,
    prior: weights[index] / total,
  }));
}

function createNode(state, move = null, parent = null, prior = 0) {
  return {
    state,
    move,
    parent,
    prior,
    visits: 0,
    valueSum: 0,
    children: [],
    unexpanded: null,
  };
}

function buildPolicyTargets(root, fallbackMove) {
  const children = root.children.filter((child) => child.move);
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
    }))
    .sort((a, b) => b.visits - a.visits);

  return {
    actions: normalized.map((entry) => entry.action),
    probs: normalized.map((entry) => Number(entry.prob.toFixed(6))),
    visits: normalized.map((entry) => entry.visits),
    totalVisits,
  };
}

function uctScore(parent, child, explorationC) {
  const q = child.visits === 0 ? 0 : child.valueSum / child.visits;
  const u = explorationC * child.prior * Math.sqrt(parent.visits + 1) / (1 + child.visits);
  return q + u;
}

function selectChild(node, explorationC) {
  let best = node.children[0];
  let bestScore = -Infinity;
  for (const child of node.children) {
    const score = uctScore(node, child, explorationC);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  return best;
}

function backpropagate(node, valueFromRootPerspective, rootPlayer) {
  let current = node;
  while (current) {
    const signed = current.state.currentPlayer === rootPlayer
      ? valueFromRootPerspective
      : -valueFromRootPerspective;
    current.visits += 1;
    current.valueSum += signed;
    current = current.parent;
  }
}

async function expandNode(node, rootPlayer, config, table, counters, deps) {
  if (node.state.status !== "playing") {
    return finalValueFor(node.state, rootPlayer);
  }

  const moves = generateLegalMoves(node.state);
  if (moves.length === 1 && moves[0].kind === "pass") {
    node.unexpanded = [{ move: moves[0], prior: 1, action: PASS_ACTION }];
  } else if (!node.unexpanded) {
    const inference = await inferPolicyValue(node.state, node.state.currentPlayer, config, deps);
    if (!inference.logits || inference.logits.length !== ACTION_SIZE) {
      throw new Error(`Unexpected policy logits shape: ${inference.logits?.length ?? "none"}`);
    }
    const ranked = rankByPolicy(inference.logits, moves).slice(0, config.candidateLimit ?? 120);
    node.unexpanded = ranked;
    const value = node.state.currentPlayer === rootPlayer ? inference.value : -inference.value;
    table.set({
      hash: hashState(node.state),
      depth: 0,
      value,
      bound: "exact",
      bestMove: ranked[0]?.move,
    });
    return value;
  }

  if (node.unexpanded.length > 0) {
    const next = node.unexpanded.shift();
    const childState = applyMove(node.state, next.move);
    const child = createNode(childState, next.move, node, next.prior);
    node.children.push(child);
    counters.nodes += 1;

    if (childState.status !== "playing") {
      return finalValueFor(childState, rootPlayer);
    }

    const inference = await inferPolicyValue(childState, childState.currentPlayer, config, deps);
    const childMoves = generateLegalMoves(childState);
    child.unexpanded = rankByPolicy(inference.logits, childMoves).slice(0, config.candidateLimit ?? 120);
    const value = childState.currentPlayer === rootPlayer ? inference.value : -inference.value;
    table.set({
      hash: hashState(childState),
      depth: 0,
      value,
      bound: "exact",
      bestMove: child.unexpanded[0]?.move,
    });
    return value;
  }

  const fallback = evaluateState(node.state, rootPlayer) / 100;
  return Math.max(-1, Math.min(1, fallback));
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
  const candidateLimit = config.candidateLimit ?? 120;
  const explorationC = config.explorationC ?? 1.5;
  const table = config.table ?? new TranspositionTable();
  const rootPlayer = state.currentPlayer;
  const counters = { simulations: 0, nodes: 1, tableHits: 0 };

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

  const root = createNode(state);
  const rootPolicy = await inferPolicyValue(state, state.currentPlayer, config, deps);
  root.unexpanded = rankByPolicy(rootPolicy.logits, legalMoves).slice(0, candidateLimit);
  let bestValue = state.currentPlayer === rootPlayer ? rootPolicy.value : -rootPolicy.value;

  while (now() - startedAt < timeLimitMs) {
    let node = root;
    while (node.children.length > 0 && node.unexpanded && node.unexpanded.length === 0) {
      node = selectChild(node, explorationC);
    }
    try {
      const stateHash = hashState(node.state);
      const cached = table.get(stateHash);
      let value;
      if (cached && cached.depth >= 0) {
        counters.tableHits += 1;
        value = cached.value;
      } else {
        value = await expandNode(node, rootPlayer, { ...config, candidateLimit }, table, counters, deps);
      }
      bestValue = value;
      backpropagate(node, value, rootPlayer);
      counters.simulations += 1;
    } catch (error) {
      const fallback = Math.max(-1, Math.min(1, evaluateMoveQuick(state, rootPlayer, legalMoves[0]) / 100));
      backpropagate(node, fallback, rootPlayer);
      counters.simulations += 1;
      if ((error?.message || "").includes("Unexpected")) {
        throw error;
      }
    }
  }

  let bestChild = root.children[0];
  for (const child of root.children) {
    if (!bestChild || child.visits > bestChild.visits) {
      bestChild = child;
    }
  }
  const bestMove = bestChild?.move ?? root.unexpanded?.[0]?.move ?? legalMoves[0];
  const policyTargets = buildPolicyTargets(root, bestMove);

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
      value: Number(bestValue.toFixed(3)),
      rootValue: Number(rootPolicy.value.toFixed(3)),
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
