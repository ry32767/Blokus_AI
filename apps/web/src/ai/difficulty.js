import { decideHeuristic, decideMcts, decidePolicyValueMcts, decideRandom } from "./engines.js";

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
            : "normal");

  return {
    difficulty,
    timeLimitMs: config.timeLimitMs ?? config.maxThinkingMs ?? 1200,
    maxThinkingMs: config.maxThinkingMs ?? config.timeLimitMs ?? 1200,
    simulations: config.simulations ?? 128,
    maxChildren: config.maxChildren ?? config.candidateLimit ?? 96,
    ...config,
    difficulty,
  };
}

function withDifficulty(decision, difficulty) {
  return {
    ...decision,
    stats: {
      difficulty,
      ...decision.stats,
    },
  };
}

export async function decideDifficultyMove(state, config = {}) {
  const normalized = normalizeAiConfig(config);

  switch (normalized.difficulty) {
    case "easy":
      return withDifficulty(await decideRandom(state, normalized), "easy");
    case "hard":
      return withDifficulty(await decideMcts(state, normalized), "hard");
    case "expert":
      return withDifficulty(await decidePolicyValueMcts(state, normalized), "expert");
    case "normal":
    default:
      return withDifficulty(await decideHeuristic(state, normalized), "normal");
  }
}
