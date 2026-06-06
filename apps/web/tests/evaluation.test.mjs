import assert from "node:assert/strict";
import { createSuite } from "../../../tests/testHarness.mjs";
import { applyMove, createInitialState, generateLegalMoves } from "../../../packages/core/src/index.js";
import {
  countCornerCandidates,
  countLegalPlacementsForPlayer,
  evaluateMoveQuick,
  evaluateState,
} from "../src/ai/evaluation.js";

const suite = createSuite("evaluation");

function createMidgameState() {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 6; i += 1) {
    state = applyMove(state, generateLegalMoves(state)[0]);
  }
  return state;
}

suite.test("opening move quick evaluation stays finite", () => {
  const state = createInitialState("fixedStart");
  const move = generateLegalMoves(state)[0];
  const value = evaluateMoveQuick(state, state.currentPlayer, move);
  assert.equal(Number.isFinite(value), true);
});

suite.test("state evaluation is from the requested player perspective", () => {
  const state = createMidgameState();
  const forBlack = evaluateState(state, 0);
  const forWhite = evaluateState(state, 1);
  assert.equal(forBlack === forWhite, false);
});

suite.test("legal placement and corner candidate helpers return non-negative counts", () => {
  const state = createMidgameState();
  assert.equal(countCornerCandidates(state, 0) >= 0, true);
  assert.equal(countCornerCandidates(state, 1) >= 0, true);
  assert.equal(countLegalPlacementsForPlayer(state, 0) >= 0, true);
  assert.equal(countLegalPlacementsForPlayer(state, 1) >= 0, true);
});

export default suite;
