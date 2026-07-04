import { applyMove, generateLegalMoves, scoreState } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, evaluateMoveQuick, evaluateState } from "./evaluation.js";
import { resolveRng, scoredDescending } from "./random.js";
import { TranspositionTable, hashState } from "./transpositionTable.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function normalizeEval(score) {
  return Math.max(-1, Math.min(1, score / 100));
}

// Terminal leaf value in the negamax convention. `advanceTurnOrFinish` does not
// toggle `currentPlayer` when the game ends, so at a terminal state
// `state.currentPlayer` is the player who made the final move — the same side
// to move at the parent node. backup() negates once per ply, so the leaf must
// report the value from the opponent-of-mover perspective (the notional side
// to move at the leaf) for the parent to read the score correctly.
export function finalValueForToMove(state) {
  const [scoreA, scoreB] = scoreState(state);
  return Math.max(-1, Math.min(1, (state.currentPlayer === 0 ? scoreB - scoreA : scoreA - scoreB) / 89));
}

function rankCandidateMoves(state, candidateLimit, rng) {
  return scoredDescending(generateLegalMoves(state), cheapMoveOrderScore, rng)
    .map(({ item: move }) => move)
    .slice(0, candidateLimit);
}

// Negamax tree node with lazy child state. node.valueSum/node.visits is the average
// value from the perspective of the player to move at that node.
function createRoot(state) {
  return { move: null, state, visits: 0, valueSum: 0, children: null, terminalValue: null };
}

function createChild(move) {
  return { move, state: null, visits: 0, valueSum: 0, children: null, terminalValue: null };
}

function selectChild(node, explorationC) {
  let bestChild = node.children[0];
  let bestScore = -Infinity;
  for (const child of node.children) {
    // child Q is in the child's (opponent's) perspective; negate for this node.
    const exploitation = child.visits === 0 ? 0 : -(child.valueSum / child.visits);
    const exploration = child.visits === 0
      ? Infinity
      : explorationC * Math.sqrt(Math.log(node.visits + 1) / child.visits);
    const score = exploitation + exploration;
    if (score > bestScore) {
      bestScore = score;
      bestChild = child;
    }
  }
  return bestChild;
}

function backup(path, leafValue) {
  let value = leafValue;
  for (let i = path.length - 1; i >= 0; i -= 1) {
    path[i].visits += 1;
    path[i].valueSum += value;
    value = -value;
  }
}

// Expand a leaf, returning its value in the leaf's to-move perspective.
function expandLeaf(node, candidateLimit, rng, table, counters) {
  if (node.state.status !== "playing") {
    node.children = [];
    node.terminalValue = finalValueForToMove(node.state);
    return node.terminalValue;
  }

  const hash = hashState(node.state);
  const cached = table.get(hash);
  let value;
  // Only reuse entries this engine wrote: alpha-beta/exact entries are on a
  // different value scale, and node.move is the edge INTO this node, not a
  // best move from it — never store it as `bestMove`.
  if (cached && cached.kind === "mcts_eval") {
    counters.tableHits += 1;
    value = cached.value;
  } else {
    value = normalizeEval(evaluateState(node.state, node.state.currentPlayer));
    table.set({ hash, kind: "mcts_eval", value });
  }

  node.children = rankCandidateMoves(node.state, candidateLimit, rng).map(createChild);
  return value;
}

export async function chooseMctsMove(state, config = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  const candidateLimit = config.candidateLimit ?? config.maxChildren ?? 120;
  const explorationC = config.explorationC ?? 1.2;
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 1500;
  const maxSimulations = config.simulations ?? config.maxSimulations ?? Infinity;
  const table = config.table ?? new TranspositionTable();
  const rng = resolveRng(config);
  const counters = { simulations: 0, nodes: 1, tableHits: 0 };

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: config.difficulty ?? "expert",
        engine: "mcts",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: -1,
        simulations: 0,
        nodes: 1,
        tableHits: 0,
      },
    };
  }

  const root = createRoot(state);
  expandLeaf(root, candidateLimit, rng, table, counters);

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

    const value = (node.children !== null && node.children.length === 0)
      ? (node.terminalValue ?? finalValueForToMove(node.state))
      : expandLeaf(node, candidateLimit, rng, table, counters);
    backup(path, value);
    counters.simulations += 1;
  }

  let bestChild = root.children?.[0] ?? null;
  for (const child of root.children ?? []) {
    if (!bestChild || child.visits > bestChild.visits || (child.visits === bestChild.visits && rng() < 0.5)) {
      bestChild = child;
    }
  }

  const bestMove = bestChild?.move ?? legalMoves[0];
  const bestValue = bestChild?.visits
    ? -(bestChild.valueSum / bestChild.visits)
    : normalizeEval(evaluateMoveQuick(state, state.currentPlayer, bestMove));

  return {
    move: bestMove,
    stats: {
      difficulty: config.difficulty ?? "expert",
      engine: "mcts",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      simulations: counters.simulations,
      nodes: counters.nodes,
      tableHits: counters.tableHits,
      value: Number(bestValue.toFixed(3)),
    },
  };
}
