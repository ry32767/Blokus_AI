import assert from "node:assert/strict";
import { createSuite } from "../../../tests/testHarness.mjs";
import { applyMove, createInitialState, generateLegalMoves, isLegalMove } from "../../../packages/core/src/index.js";
import { AI_DIFFICULTIES, decideDifficultyMove, normalizeAiConfig } from "../src/ai/difficulty.js";

const suite = createSuite("ai-smoke");

function createReducedBranchState() {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 6; i += 1) {
    const move = generateLegalMoves(state)[0];
    state = applyMove(state, move);
  }
  return state;
}

suite.test("difficulty normalization maps legacy engine names", () => {
  assert.equal(normalizeAiConfig({ engine: "random" }).difficulty, "easy");
  assert.equal(normalizeAiConfig({ engine: "heuristic" }).difficulty, "normal");
  assert.equal(normalizeAiConfig({ engine: "mcts" }).difficulty, "hard");
  assert.equal(normalizeAiConfig({ engine: "policy_value_mcts" }).difficulty, "expert");
});

suite.test("every difficulty returns a legal opening move", async () => {
  for (const difficulty of ["easy", "normal"]) {
    const state = createInitialState("fixedStart");
    const decision = await decideDifficultyMove(state, { difficulty, timeLimitMs: 120 });
    assert.equal(isLegalMove(state, decision.move), true, `${difficulty} should return a legal move`);
    assert.equal(decision.stats.difficulty, difficulty);
  }
});

suite.test("every difficulty handles a midgame state legally", async () => {
  const state = createReducedBranchState();

  for (const difficulty of AI_DIFFICULTIES) {
    const decision = await decideDifficultyMove(state, {
      difficulty,
      timeLimitMs: 120,
      simulations: 4,
      maxChildren: 8,
      candidateLimit: 8,
    });
    assert.equal(isLegalMove(state, decision.move), true, `${difficulty} should stay legal in midgame`);
  }
});

export default suite;
