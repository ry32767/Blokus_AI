import { applyMove, generateLegalMoves, scoreState } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, evaluateState } from "./evaluation.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function otherPlayer(player) {
  return player === 0 ? 1 : 0;
}

function rankMoves(state, player, beamWidth) {
  return generateLegalMoves(state)
    .map((move) => ({ move, score: cheapMoveOrderScore(move) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, beamWidth);
}

function quickLeaf(state, rootPlayer) {
  const [scoreA, scoreB] = scoreState(state);
  const myScore = rootPlayer === 0 ? scoreA : scoreB;
  const oppScore = rootPlayer === 0 ? scoreB : scoreA;
  return myScore - oppScore;
}

function evaluateLeaf(state, rootPlayer) {
  return evaluateState(state, rootPlayer);
}

function searchLayer(state, rootPlayer, depth, maxDepth, options, startedAt) {
  if (now() - startedAt >= options.timeLimitMs) {
    return quickLeaf(state, rootPlayer);
  }

  if (depth >= maxDepth || state.status !== "playing") {
    return evaluateLeaf(state, rootPlayer);
  }

  const currentPlayer = state.currentPlayer;
  const maximizing = currentPlayer === rootPlayer;
  const beamWidth = maximizing ? options.beamWidthSelf : options.beamWidthOpponent;
  const rankedMoves = rankMoves(state, rootPlayer, beamWidth);

  if (rankedMoves.length === 0) {
    return evaluateLeaf(state, rootPlayer);
  }

  let bestValue = maximizing ? -Infinity : Infinity;
  for (const { move } of rankedMoves) {
    const nextState = applyMove(state, move);
    const childValue = searchLayer(nextState, rootPlayer, depth + 1, maxDepth, options, startedAt);
    if (maximizing) {
      bestValue = Math.max(bestValue, childValue);
    } else {
      bestValue = Math.min(bestValue, childValue);
    }
  }

  return bestValue;
}

export async function chooseBeamSearchMove(state, config = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: "hard",
        engine: "beam_search",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: -1,
        beamWidth: config.beamWidthSelf ?? 32,
        depth: config.depth ?? 3,
      },
    };
  }

  const requestedTimeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 800;
  const opening = state.turn < 6 || legalMoves.length > 180;
  const options = {
    depth: opening ? Math.min(config.depth ?? 3, 2) : config.depth ?? 3,
    beamWidthSelf: opening ? Math.min(config.beamWidthSelf ?? 32, 10) : Math.min(config.beamWidthSelf ?? 32, 18),
    beamWidthOpponent: opening ? Math.min(config.beamWidthOpponent ?? 32, 8) : Math.min(config.beamWidthOpponent ?? 32, 16),
    timeLimitMs: requestedTimeLimitMs,
  };

  const rootPlayer = state.currentPlayer;
  const rankedMoves = rankMoves(state, rootPlayer, options.beamWidthSelf);
  let bestMove = rankedMoves[0].move;
  let bestValue = -Infinity;
  let visitedNodes = 0;

  for (const { move } of rankedMoves) {
    if (now() - startedAt >= options.timeLimitMs) break;
    const nextState = applyMove(state, move);
    const value = searchLayer(nextState, rootPlayer, 1, options.depth, options, startedAt);
    visitedNodes += 1;
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
  }

  return {
    move: bestMove,
    stats: {
      difficulty: "hard",
      engine: "beam_search",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      depth: options.depth,
      beamWidth: options.beamWidthSelf,
      nodes: visitedNodes,
      value: Number(bestValue.toFixed(2)),
    },
  };
}
