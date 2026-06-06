import { chooseEndgameAlphaBetaMove } from "./alphaBetaAi.js";
import { chooseHeuristicMove } from "./heuristicAi.js";
import { chooseMctsMove } from "./mctsAi.js";
import { totalLegalPlacements, totalRemainingPieces, TranspositionTable } from "./transpositionTable.js";

export function isOpening(state) {
  return state.turn < 4;
}

export function isEndgameSearchable(state) {
  return totalLegalPlacements(state) <= 400 || totalRemainingPieces(state) <= 8;
}

export async function chooseOpeningHeuristicMove(state, config = {}) {
  return chooseHeuristicMove(state, {
    ...config,
    difficulty: "expert",
    profile: "strong",
  });
}

export async function chooseExpertMove(state, config = {}) {
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 1500;
  const table = config.table ?? new TranspositionTable();

  if (isOpening(state)) {
    const decision = await chooseOpeningHeuristicMove(state, config);
    return {
      ...decision,
      stats: {
        ...decision.stats,
        difficulty: "expert",
        engine: "expert",
        strategy: decision.stats.engine,
      },
    };
  }

  if (isEndgameSearchable(state)) {
    const decision = await chooseEndgameAlphaBetaMove(state, {
      ...config,
      difficulty: "expert",
      timeLimitMs,
      table,
    });
    return {
      ...decision,
      stats: {
        ...decision.stats,
        difficulty: "expert",
        engine: "expert",
        strategy: decision.stats.engine,
      },
    };
  }

  const decision = await chooseMctsMove(state, {
    ...config,
    difficulty: "expert",
    timeLimitMs,
    candidateLimit: config.candidateLimit ?? 120,
    explorationC: config.explorationC ?? 1.2,
    table,
  });

  return {
    ...decision,
    stats: {
      ...decision.stats,
      difficulty: "expert",
      engine: "expert",
      strategy: decision.stats.engine,
    },
  };
}
