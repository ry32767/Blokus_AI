import {
  BOARD_SIZE,
  DIAGONAL_DIRS,
  EMPTY,
  ORTHOGONAL_DIRS,
  applyMove,
  generateLegalMoves,
  getCell,
  getCellsForMove,
  scoreState,
} from "../../../../packages/core/src/index.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function randomChoice(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function countCornerCandidates(state, player) {
  const seen = new Set();
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (getCell(state.board, x, y) !== player) continue;
      for (const [dx, dy] of DIAGONAL_DIRS) {
        const cx = x + dx;
        const cy = y + dy;
        if (getCell(state.board, cx, cy) !== EMPTY) continue;
        let edgeBlocked = false;
        for (const [ex, ey] of ORTHOGONAL_DIRS) {
          if (getCell(state.board, cx + ex, cy + ey) === player) edgeBlocked = true;
        }
        if (!edgeBlocked) seen.add(`${cx},${cy}`);
      }
    }
  }
  return seen.size;
}

function centerAdvance(cells) {
  return cells.reduce((sum, cell) => {
    const dx = Math.abs(cell.x - 6.5);
    const dy = Math.abs(cell.y - 6.5);
    return sum + (7 - Math.max(dx, dy));
  }, 0);
}

export function heuristicScore(state, move) {
  if (move.kind === "pass") return -10000;
  const player = state.currentPlayer;
  const opponent = player === 0 ? 1 : 0;
  const beforeOwnCorners = countCornerCandidates(state, player);
  const beforeOpponentCorners = countCornerCandidates(state, opponent);
  const cells = getCellsForMove(move);
  const next = applyMove(state, move);
  const afterOwnCorners = countCornerCandidates(next, player);
  const afterOpponentCorners = countCornerCandidates(next, opponent);
  const remainingLargePieces = next.remainingPieces[player].filter((pieceId) => pieceId.endsWith("5")).length;
  const scores = scoreState(next);

  return (
    10.0 * cells.length +
    2.0 * (afterOwnCorners - beforeOwnCorners) +
    1.0 * (beforeOpponentCorners - afterOpponentCorners) -
    0.5 * remainingLargePieces +
    0.2 * centerAdvance(cells) +
    0.1 * (scores[player] - scores[opponent])
  );
}

export async function decideRandom(state, config = {}) {
  const start = now();
  const legalMoves = generateLegalMoves(state);
  const move = randomChoice(legalMoves);
  return {
    move,
    stats: {
      engine: "random",
      thinkingMs: Math.round(now() - start),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: move.kind === "place" ? move.pieceId : undefined,
    },
  };
}

export async function decideHeuristic(state, config = {}) {
  const start = now();
  const legalMoves = generateLegalMoves(state);
  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        engine: "heuristic",
        thinkingMs: Math.round(now() - start),
        legalMoves: 1,
        selectedAction: -1,
      },
    };
  }

  let bestMove = legalMoves[0];
  let bestScore = -Infinity;
  for (const move of legalMoves) {
    const score = heuristicScore(state, move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return {
    move: bestMove,
    stats: {
      engine: "heuristic",
      thinkingMs: Math.round(now() - start),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      value: Number(bestScore.toFixed(2)),
    },
  };
}

function evaluateStateForPlayer(state, player) {
  const opponent = player === 0 ? 1 : 0;
  const scores = scoreState(state);
  const ownMoves = state.status === "playing" ? generateLegalMoves({ ...state, currentPlayer: player }).length : 0;
  const opponentMoves = state.status === "playing" ? generateLegalMoves({ ...state, currentPlayer: opponent }).length : 0;
  return scores[player] - scores[opponent] + 0.02 * (ownMoves - opponentMoves);
}

export async function decideMcts(state, config = {}) {
  const start = now();
  const legalMoves = generateLegalMoves(state);
  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        engine: "mcts",
        thinkingMs: Math.round(now() - start),
        legalMoves: 1,
        selectedAction: -1,
        simulations: 0,
        nodes: 1,
      },
    };
  }

  const player = state.currentPlayer;
  const maxThinkingMs = config.maxThinkingMs ?? 1200;
  const maxChildren = Math.min(config.maxChildren ?? 96, legalMoves.length);
  const ranked = legalMoves
    .map((move) => ({ move, prior: heuristicScore(state, move) }))
    .sort((a, b) => b.prior - a.prior)
    .slice(0, maxChildren);

  const visits = new Map(ranked.map(({ move }) => [move, 0]));
  const values = new Map(ranked.map(({ move }) => [move, 0]));
  let simulations = 0;

  while (simulations < (config.simulations ?? 128) && now() - start < maxThinkingMs) {
    const candidate = ranked[simulations % ranked.length].move;
    let next = applyMove(state, candidate);
    let depth = 0;
    while (next.status === "playing" && depth < 2) {
      const response = await decideHeuristic(next);
      next = applyMove(next, response.move);
      depth += 1;
    }
    const value = evaluateStateForPlayer(next, player);
    visits.set(candidate, visits.get(candidate) + 1);
    values.set(candidate, values.get(candidate) + value);
    simulations += 1;
  }

  let bestMove = ranked[0].move;
  let bestAverage = -Infinity;
  for (const { move, prior } of ranked) {
    const visitCount = visits.get(move);
    const average = visitCount > 0 ? values.get(move) / visitCount : prior;
    if (average > bestAverage) {
      bestAverage = average;
      bestMove = move;
    }
  }

  return {
    move: bestMove,
    stats: {
      engine: "mcts",
      thinkingMs: Math.round(now() - start),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      simulations,
      nodes: ranked.length,
      value: Number(bestAverage.toFixed(2)),
    },
  };
}

export async function decidePolicyValueMcts(state, config = {}) {
  const decision = await decideHeuristic(state, config);
  return {
    ...decision,
    stats: {
      ...decision.stats,
      engine: "policy_value_mcts",
      value: decision.stats.value,
      modelLoaded: false,
      fallback: "heuristic",
    },
  };
}

export async function decideAiMove(state, config = {}) {
  switch (config.engine) {
    case "random":
      return decideRandom(state, config);
    case "mcts":
      return decideMcts(state, config);
    case "policy_value_mcts":
      return decidePolicyValueMcts(state, config);
    case "heuristic":
    default:
      return decideHeuristic(state, config);
  }
}
