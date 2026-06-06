import { chooseBeamSearchMove } from "./beamSearchAi.js";
import { chooseExpertMove } from "./expertAi.js";
import { chooseHeuristicMove } from "./heuristicAi.js";
import { chooseMctsMove } from "./mctsAi.js";

export const AI_DIFFICULTIES = ["easy", "normal", "hard", "expert"];

export function normalizeAiConfig(config = {}) {
  const difficulty = config.difficulty
    ?? (config.engine === "random"
      ? "easy"
      : config.engine === "heuristic"
        ? "normal"
        : config.engine === "mcts"
          ? "hard"
          : config.engine === "policy_value_mcts"
            ? "expert"
            : config.engine === "easy"
              ? "easy"
              : config.engine === "normal"
                ? "normal"
                : config.engine === "hard"
                  ? "hard"
                  : config.engine === "expert"
                    ? "expert"
                    : "normal");

  return {
    difficulty,
    timeLimitMs: config.timeLimitMs ?? config.maxThinkingMs ?? (difficulty === "expert" ? 1500 : difficulty === "hard" ? 800 : 300),
    maxThinkingMs: config.maxThinkingMs ?? config.timeLimitMs ?? (difficulty === "expert" ? 1500 : difficulty === "hard" ? 800 : 300),
    depth: config.depth ?? 3,
    beamWidthSelf: config.beamWidthSelf ?? 32,
    beamWidthOpponent: config.beamWidthOpponent ?? 32,
    candidateLimit: config.candidateLimit ?? config.maxChildren ?? 120,
    maxChildren: config.maxChildren ?? config.candidateLimit ?? 120,
    simulations: config.simulations ?? 128,
    explorationC: config.explorationC ?? 1.2,
    ...config,
    difficulty,
  };
}

export async function decideDifficultyMove(state, config = {}) {
  const normalized = normalizeAiConfig(config);

  switch (normalized.difficulty) {
    case "easy":
      return chooseHeuristicMove(state, { ...normalized, profile: "weak", difficulty: "easy" });
    case "hard":
      return chooseBeamSearchMove(state, { ...normalized, difficulty: "hard" });
    case "expert":
      return chooseExpertMove(state, { ...normalized, difficulty: "expert" });
    case "normal":
    default:
      return chooseHeuristicMove(state, { ...normalized, profile: "strong", difficulty: "normal" });
  }
}

export async function decideFallbackMove(state, config = {}) {
  return chooseHeuristicMove(state, {
    ...normalizeAiConfig(config),
    difficulty: "normal",
    profile: "strong",
  });
}
