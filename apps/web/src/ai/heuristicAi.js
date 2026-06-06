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

export async function chooseHeuristicMove(state, config = {}) {
  const startedAt = now();
  const difficulty = config.difficulty ?? "normal";
  const profile = config.profile ?? (difficulty === "easy" ? "weak" : "strong");
  const legalMoves = generateLegalMoves(state);

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return toPassDecision(legalMoves[0], startedAt, "heuristic", difficulty);
  }

  const player = state.currentPlayer;
  const scoreMove = createHeuristicScorer(profile);
  const shortlist = legalMoves
    .map((move) => ({ move, order: cheapMoveOrderScore(move) }))
    .sort((a, b) => b.order - a.order)
    .slice(0, profile === "weak" ? 48 : 96)
    .map((entry) => entry.move);

  let bestMove = shortlist[0];
  let bestValue = -Infinity;

  for (const move of shortlist) {
    const value = scoreMove(state, player, move);
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
      value: Number(bestValue.toFixed(2)),
    },
  };
}
