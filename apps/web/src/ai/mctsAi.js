import { applyMove, generateLegalMoves } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, evaluateMoveQuick, evaluateState } from "./evaluation.js";
import { TranspositionTable, hashState } from "./transpositionTable.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function rankCandidateMoves(state, player, candidateLimit) {
  return generateLegalMoves(state)
    .map((move) => ({ move, score: cheapMoveOrderScore(move) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, candidateLimit);
}

function createNode(state, move = null, parent = null) {
  return {
    state,
    move,
    parent,
    children: [],
    unexpanded: null,
    visits: 0,
    valueSum: 0,
  };
}

function ensureUnexpanded(node, rootPlayer, candidateLimit) {
  if (node.unexpanded) return node.unexpanded;
  node.unexpanded = rankCandidateMoves(node.state, rootPlayer, candidateLimit);
  return node.unexpanded;
}

function selectChild(node, explorationC) {
  let bestChild = node.children[0];
  let bestScore = -Infinity;

  for (const child of node.children) {
    const exploitation = child.visits === 0 ? 0 : child.valueSum / child.visits;
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

function backpropagate(node, value) {
  let current = node;
  while (current) {
    current.visits += 1;
    current.valueSum += value;
    current = current.parent;
  }
}

export async function chooseMctsMove(state, config = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  const rootPlayer = state.currentPlayer;
  const candidateLimit = config.candidateLimit ?? config.maxChildren ?? 120;
  const explorationC = config.explorationC ?? 1.2;
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 1500;
  const table = config.table ?? new TranspositionTable();

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

  const root = createNode(state);
  let simulations = 0;
  let nodes = 1;
  let tableHits = 0;

  while (now() - startedAt < timeLimitMs) {
    let node = root;

    while (node.children.length > 0 && ensureUnexpanded(node, rootPlayer, candidateLimit).length === 0) {
      node = selectChild(node, explorationC);
    }

    const unexpanded = ensureUnexpanded(node, rootPlayer, candidateLimit);
    if (unexpanded.length > 0 && now() - startedAt < timeLimitMs) {
      const { move } = unexpanded.shift();
      const nextState = applyMove(node.state, move);
      const child = createNode(nextState, move, node);
      node.children.push(child);
      node = child;
      nodes += 1;
    }

    const stateHash = hashState(node.state);
    const cached = table.get(stateHash);
    let value;
    if (cached) {
      tableHits += 1;
      value = cached.value;
    } else {
      value = evaluateState(node.state, rootPlayer);
      table.set({
        hash: stateHash,
        depth: 0,
        value,
        bound: "exact",
        bestMove: node.move ?? undefined,
        visits: node.visits,
      });
    }

    backpropagate(node, value);
    simulations += 1;
  }

  let bestChild = root.children[0];
  for (const child of root.children) {
    if (!bestChild || child.visits > bestChild.visits) {
      bestChild = child;
    }
  }

  const bestMove = bestChild?.move ?? legalMoves[0];
  const bestValue = bestChild?.visits ? bestChild.valueSum / bestChild.visits : evaluateMoveQuick(state, rootPlayer, bestMove);

  return {
    move: bestMove,
    stats: {
      difficulty: config.difficulty ?? "expert",
      engine: "mcts",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      simulations,
      nodes,
      tableHits,
      value: Number(bestValue.toFixed(2)),
    },
  };
}
