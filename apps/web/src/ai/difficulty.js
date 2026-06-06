import { chooseBeamSearchMove } from "./beamSearchAi.js";
import { chooseExpertMove } from "./expertAi.js";
import { chooseHeuristicMove } from "./heuristicAi.js";
import { chooseMctsMove } from "./mctsAi.js";

export const AI_DIFFICULTIES = ["easy", "normal", "hard", "expert"];

function difficultyFromEngine(engine) {
  return engine === "random"
    ? "easy"
    : engine === "heuristic"
      ? "normal"
      : engine === "mcts"
        ? "hard"
        : engine === "policy_value_mcts"
          ? "expert"
          : engine === "easy"
            ? "easy"
            : engine === "normal"
              ? "normal"
              : engine === "hard"
                ? "hard"
                : engine === "expert"
                  ? "expert"
                  : null;
}

export function normalizeAiConfig(config = {}) {
  const difficulty = difficultyFromEngine(config.engine) ?? config.difficulty ?? "normal";

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
    engine: config.engine ?? difficulty,
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
