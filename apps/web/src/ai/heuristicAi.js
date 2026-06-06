import { generateLegalMoves } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, createHeuristicScorer } from "./evaluation.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function toPassDecision(move, startedAt, engine, difficulty) {
  return {
    move,
    stats: {
      difficulty,
      engine,
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: 1,
      selectedAction: -1,
    },
  };
}

function shortlistLimitFor(state, profile, config) {
  if (config.shortlistLimit) return config.shortlistLimit;
  const opening = state.turn < 6;
  if (profile === "weak") return opening ? 10 : 24;
  return opening ? 16 : 40;
}

export async function chooseHeuristicMove(state, config = {}) {
  const startedAt = now();
  const difficulty = config.difficulty ?? "normal";
  const profile = config.profile ?? (difficulty === "easy" ? "weak" : "strong");
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? (profile === "weak" ? 250 : 400);
  const legalMoves = generateLegalMoves(state);

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return toPassDecision(legalMoves[0], startedAt, "heuristic", difficulty);
  }

  const player = state.currentPlayer;
  const scoreMove = createHeuristicScorer(profile);
  const shortlist = legalMoves
    .map((move) => ({ move, order: cheapMoveOrderScore(move) }))
    .sort((a, b) => b.order - a.order)
    .slice(0, shortlistLimitFor(state, profile, config))
    .map((entry) => entry.move);

  let bestMove = shortlist[0];
  let bestValue = scoreMove(state, player, bestMove);
  let evaluatedMoves = 1;

  for (const move of shortlist.slice(1)) {
    if (now() - startedAt >= timeLimitMs) break;
    const value = scoreMove(state, player, move);
    evaluatedMoves += 1;
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
  }

  return {
    move: bestMove,
    stats: {
      difficulty,
      engine: "heuristic",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      nodes: evaluatedMoves,
      value: Number(bestValue.toFixed(2)),
    },
  };
}
