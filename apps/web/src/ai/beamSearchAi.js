import { applyMove, generateLegalMoves } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, evaluateMoveQuick, evaluateState } from "./evaluation.js";

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

function evaluateLeaf(state, rootPlayer) {
  return evaluateState(state, rootPlayer);
}

function searchLayer(state, rootPlayer, depth, maxDepth, options, startedAt) {
  if (now() - startedAt >= options.timeLimitMs) {
    return evaluateLeaf(state, rootPlayer);
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

  const options = {
    depth: config.depth ?? 3,
    beamWidthSelf: config.beamWidthSelf ?? 32,
    beamWidthOpponent: config.beamWidthOpponent ?? 32,
    timeLimitMs: config.timeLimitMs ?? config.maxThinkingMs ?? 800,
  };

  const rootPlayer = state.currentPlayer;
  const rankedMoves = rankMoves(state, rootPlayer, options.beamWidthSelf);
  let bestMove = rankedMoves[0].move;
  let bestValue = -Infinity;

  for (const { move } of rankedMoves) {
    if (now() - startedAt >= options.timeLimitMs) break;
    const nextState = applyMove(state, move);
    const value = searchLayer(nextState, rootPlayer, 1, options.depth, options, startedAt);
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
      value: Number(bestValue.toFixed(2)),
    },
  };
}
