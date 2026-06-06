import { chooseEndgameAlphaBetaMove, chooseExactEndgameMove } from "./alphaBetaAi.js";
import { chooseHeuristicMove } from "./heuristicAi.js";
import { chooseMctsMove } from "./mctsAi.js";
import { totalLegalPlacements, totalRemainingPieces, TranspositionTable } from "./transpositionTable.js";

export function isOpening(state) {
  return state.turn < 4;
}

export function isEndgameSearchable(state) {
  return totalLegalPlacements(state) <= 400 || totalRemainingPieces(state) <= 8;
}

export function isDeepEndgame(state) {
  return totalLegalPlacements(state) <= 220 || totalRemainingPieces(state) <= 6;
}

export function isExactSolvable(state) {
  return totalLegalPlacements(state) <= 80 && totalRemainingPieces(state) <= 4;
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

export async function chooseExpertPlusMove(state, config = {}) {
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 4000;
  const table = config.table ?? new TranspositionTable();

  if (isOpening(state)) {
    const decision = await chooseOpeningHeuristicMove(state, {
      ...config,
      difficulty: "expert_plus",
      shortlistLimit: config.shortlistLimit ?? 20,
    });
    return {
      ...decision,
      stats: {
        ...decision.stats,
        difficulty: "expert_plus",
        engine: "expert_plus",
        strategy: "opening_heuristic",
      },
    };
  }

  if (isExactSolvable(state)) {
    const decision = await chooseExactEndgameMove(state, {
      ...config,
      difficulty: "expert_plus",
      timeLimitMs,
      table,
    });
    return {
      ...decision,
      stats: {
        ...decision.stats,
        difficulty: "expert_plus",
        engine: "expert_plus",
        strategy: decision.stats.strategy ?? "exact",
      },
    };
  }

  if (isDeepEndgame(state)) {
    const decision = await chooseEndgameAlphaBetaMove(state, {
      ...config,
      difficulty: "expert_plus",
      timeLimitMs,
      maxDepth: config.maxDepth ?? 8,
      table,
    });
    return {
      ...decision,
      stats: {
        ...decision.stats,
        difficulty: "expert_plus",
        engine: "expert_plus",
        strategy: "alpha_beta",
      },
    };
  }

  const decision = await chooseMctsMove(state, {
    ...config,
    difficulty: "expert_plus",
    timeLimitMs,
    candidateLimit: config.candidateLimit ?? 160,
    explorationC: config.explorationC ?? 1.1,
    table,
  });

  return {
    ...decision,
    stats: {
      ...decision.stats,
      difficulty: "expert_plus",
      engine: "expert_plus",
      strategy: "mcts",
    },
  };
}
