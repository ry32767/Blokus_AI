import assert from "node:assert/strict";
import {
  ACTION_SIZE,
  ORIENTATIONS,
  PASS_ACTION,
  PIECE_IDS,
  PIECE_SHAPES,
  applyMove,
  createInitialState,
  decodeAction,
  encodeAction,
  generateLegalMoves,
  getOrientations,
  isLegalMove,
  scorePlayer,
} from "../src/index.js";

const expectedOrientationCounts = {
  I1: 1,
  I2: 2,
  I3: 2,
  V3: 4,
  I4: 2,
  O4: 1,
  T4: 4,
  L4: 8,
  Z4: 4,
  F5: 8,
  I5: 2,
  L5: 8,
  P5: 8,
  T5: 4,
  U5: 4,
  V5: 4,
  W5: 4,
  X5: 1,
  Y5: 8,
  Z5: 4,
  N5: 8,
};

function testPieces() {
  assert.equal(PIECE_IDS.length, 21, "piece count");
  const totalUnits = PIECE_IDS.reduce((sum, id) => sum + PIECE_SHAPES[id].length, 0);
  assert.equal(totalUnits, 89, "total unit squares");
  assert.equal(ORIENTATIONS.length, 91, "orientation count");
  for (const pieceId of PIECE_IDS) {
    assert.equal(getOrientations(pieceId).length, expectedOrientationCounts[pieceId], pieceId);
    for (const orientation of getOrientations(pieceId)) {
      const minX = Math.min(...orientation.cells.map(([x]) => x));
      const minY = Math.min(...orientation.cells.map(([, y]) => y));
      assert.equal(minX, 0, `${pieceId} normalized x`);
      assert.equal(minY, 0, `${pieceId} normalized y`);
    }
  }
}

function testInitialMoveCounts() {
  assert.equal(generateLegalMoves(createInitialState("chooseStart")).length, 828, "chooseStart moves");
  assert.equal(generateLegalMoves(createInitialState("fixedStart")).length, 414, "fixedStart moves");
}

function testActionEncoding() {
  const state = createInitialState("fixedStart");
  const move = generateLegalMoves(state)[0];
  const action = encodeAction(move);
  assert.ok(action >= 0 && action < ACTION_SIZE);
  assert.deepEqual(decodeAction(action, move.player), move);
  assert.equal(encodeAction({ kind: "pass", player: 0 }), PASS_ACTION);
}

function testMoveApplicationAndPassRules() {
  let state = createInitialState("fixedStart");
  const first = generateLegalMoves(state).find((move) => move.kind === "place" && move.pieceId === "I1");
  assert.ok(first);
  state = applyMove(state, first);
  assert.equal(state.currentPlayer, 1);
  assert.equal(state.board[4 * 14 + 4], 0);
  assert.equal(isLegalMove(state, { kind: "pass", player: 1 }), false, "pass disabled while moves exist");
}

function testScoring() {
  const emptyFinished = createInitialState("fixedStart");
  emptyFinished.status = "finished";
  assert.equal(scorePlayer(emptyFinished, 0), -89);

  const completed = createInitialState("fixedStart");
  completed.remainingPieces[0] = [];
  completed.lastPlacedPiece[0] = "I1";
  assert.equal(scorePlayer(completed, 0), 20);

  completed.lastPlacedPiece[0] = "I2";
  assert.equal(scorePlayer(completed, 0), 15);
}

function testRandomBaseline() {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 60 && state.status === "playing"; i += 1) {
    const moves = generateLegalMoves(state);
    const move = moves[Math.floor((i * 17) % moves.length)];
    assert.equal(isLegalMove(state, move), true);
    state = applyMove(state, move);
  }
}

testPieces();
testInitialMoveCounts();
testActionEncoding();
testMoveApplicationAndPassRules();
testScoring();
testRandomBaseline();

console.log("Core tests passed.");
