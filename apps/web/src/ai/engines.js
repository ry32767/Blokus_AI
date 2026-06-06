import { chooseBeamSearchMove } from "./beamSearchAi.js";
import { chooseExpertMove } from "./expertAi.js";
import { chooseHeuristicMove } from "./heuristicAi.js";
import { chooseMctsMove } from "./mctsAi.js";

export async function decideRandom(state, config = {}) {
  return chooseHeuristicMove(state, {
    ...config,
    difficulty: "easy",
    profile: "weak",
  });
}

export async function decideHeuristic(state, config = {}) {
  return chooseHeuristicMove(state, {
    ...config,
    difficulty: config.difficulty ?? "normal",
    profile: config.profile ?? "strong",
  });
}

export async function decideMcts(state, config = {}) {
  return chooseMctsMove(state, {
    ...config,
    difficulty: config.difficulty ?? "expert",
  });
}

export async function decidePolicyValueMcts(state, config = {}) {
  return chooseExpertMove(state, {
    ...config,
    difficulty: "expert",
  });
}

export async function decideAiMove(state, config = {}) {
  switch (config.engine) {
    case "easy":
    case "random":
      return decideRandom(state, config);
    case "hard":
    case "beam_search":
      return chooseBeamSearchMove(state, { ...config, difficulty: "hard" });
    case "expert":
    case "policy_value_mcts":
      return chooseExpertMove(state, { ...config, difficulty: "expert" });
    case "mcts":
      return decideMcts(state, config);
    case "normal":
    case "heuristic":
    default:
      return decideHeuristic(state, config);
  }
}
