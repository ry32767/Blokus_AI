import { generateLegalMoves } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, createHeuristicScorer } from "./evaluation.js";
import { chooseBestByScore, resolveRng, scoredDescending } from "./random.js";

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
  const rng = resolveRng(config);

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return toPassDecision(legalMoves[0], startedAt, "heuristic", difficulty);
  }

  const player = state.currentPlayer;
  const scoreMove = createHeuristicScorer(profile);
  const shortlist = scoredDescending(legalMoves, cheapMoveOrderScore, rng)
    .slice(0, shortlistLimitFor(state, profile, config))
    .map((entry) => entry.item);

  const evaluated = [];
  for (const move of shortlist) {
    if (now() - startedAt >= timeLimitMs) break;
    evaluated.push({ move, value: scoreMove(state, player, move) });
  }
  const fallbackEntry = { move: shortlist[0], value: scoreMove(state, player, shortlist[0]) };
  const { item: bestEntry, score: bestValue } = chooseBestByScore(
    evaluated.length > 0 ? evaluated : [fallbackEntry],
    (entry) => entry.value,
    rng,
  );
  const bestMove = bestEntry.move;
  const evaluatedMoves = Math.max(1, evaluated.length);

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
