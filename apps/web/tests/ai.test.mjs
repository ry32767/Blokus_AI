import assert from "node:assert/strict";
import { createSuite } from "../../../tests/testHarness.mjs";
import { applyMove, createInitialState, generateLegalMoves, isLegalMove } from "../../../packages/core/src/index.js";
import { chooseEndgameAlphaBetaMove } from "../src/ai/alphaBetaAi.js";
import { chooseBeamSearchMove } from "../src/ai/beamSearchAi.js";
import { chooseExpertMove, isEndgameSearchable, isOpening } from "../src/ai/expertAi.js";
import { chooseHeuristicMove } from "../src/ai/heuristicAi.js";
import { chooseMctsMove } from "../src/ai/mctsAi.js";
import { TranspositionTable, hashState } from "../src/ai/transpositionTable.js";
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

function moveSignature(move) {
  return move.kind === "place"
    ? `${move.pieceId}:${move.orientationGlobalId}:${move.x},${move.y}`
    : move.kind;
}

suite.test("difficulty normalization maps legacy engine names", () => {
  assert.equal(normalizeAiConfig({ engine: "random" }).difficulty, "easy");
  assert.equal(normalizeAiConfig({ engine: "heuristic" }).difficulty, "normal");
  assert.equal(normalizeAiConfig({ engine: "mcts" }).difficulty, "hard");
  assert.equal(normalizeAiConfig({ engine: "policy_value_mcts" }).difficulty, "expert");
});

suite.test("engine selection overrides stale saved difficulty", () => {
  const normalized = normalizeAiConfig({
    engine: "easy",
    difficulty: "normal",
    maxThinkingMs: 900,
  });
  assert.equal(normalized.difficulty, "easy");
  assert.equal(normalized.engine, "easy");
});

suite.test("every difficulty returns a legal opening move", async () => {
  for (const difficulty of ["easy", "normal", "hard", "expert"]) {
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

suite.test("difficulty choice changes decisions on a representative midgame", async () => {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 8; i += 1) {
    state = applyMove(state, generateLegalMoves(state)[0]);
  }

  const signatures = new Set();
  for (const difficulty of AI_DIFFICULTIES) {
    const decision = await decideDifficultyMove(state, {
      engine: difficulty,
      difficulty,
      timeLimitMs: 600,
      maxThinkingMs: 600,
    });
    signatures.add(moveSignature(decision.move));
  }

  assert.ok(signatures.size >= 2, "expected at least two distinct moves across difficulty levels");
});

suite.test("beam search returns a legal move", async () => {
  const state = createReducedBranchState();
  const decision = await chooseBeamSearchMove(state, { difficulty: "hard", timeLimitMs: 120, depth: 2, beamWidthSelf: 8, beamWidthOpponent: 8 });
  assert.equal(isLegalMove(state, decision.move), true);
  assert.equal(decision.stats.engine, "beam_search");
});

suite.test("mcts returns a legal move", async () => {
  const state = createReducedBranchState();
  const decision = await chooseMctsMove(state, { difficulty: "expert", timeLimitMs: 120, candidateLimit: 12 });
  assert.equal(isLegalMove(state, decision.move), true);
  assert.equal(decision.stats.engine, "mcts");
});

suite.test("alpha-beta returns a legal move in searchable endgames", async () => {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 34; i += 1) {
    const legalMoves = generateLegalMoves(state);
    state = applyMove(state, legalMoves[0]);
    if (isEndgameSearchable(state)) break;
  }

  const decision = await chooseEndgameAlphaBetaMove(state, { difficulty: "expert", timeLimitMs: 120, maxDepth: 3 });
  assert.equal(isLegalMove(state, decision.move), true);
  assert.equal(decision.stats.engine, "alpha_beta");
});

suite.test("expert opening branch stays legal", async () => {
  const state = createInitialState("fixedStart");
  assert.equal(isOpening(state), true);
  const decision = await chooseExpertMove(state, { difficulty: "expert", timeLimitMs: 120 });
  assert.equal(isLegalMove(state, decision.move), true);
  assert.equal(decision.stats.engine, "expert");
  assert.equal(decision.stats.strategy, "heuristic");
});

suite.test("transposition hashing is stable for identical positions", () => {
  const state = createReducedBranchState();
  const twin = structuredClone(state);
  assert.equal(hashState(state), hashState(twin));

  const table = new TranspositionTable();
  table.set({ hash: hashState(state), depth: 1, value: 12, bound: "exact" });
  assert.equal(table.get(hashState(twin)).value, 12);
});

export default suite;
