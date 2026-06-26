// Generates language-agnostic golden parity vectors for the native (Rust) self-play
// core. Any reimplementation of the Blokus Duo rules/encoders MUST reproduce these
// exactly, or a trained model would be fed inconsistent inputs at inference.
//
// Run: node training/native/parity/gen_golden.mjs
// Output: training/native/parity/golden.json
//
// Canonical serialisations (the native side must match byte-for-byte):
//   board byte  : cell === EMPTY(-1) ? 0 : (cell + 1)  -> {0,1,2}, row-major (y then x)
//   state bytes : Float32 little-endian, order = plane(0..51) -> y(0..14) -> x(0..14)
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_SIZE,
  BOARD_SIZE,
  ORIENTATIONS,
  PASS_ACTION,
  applyMove,
  createInitialState,
  decodeAction,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
  scorePlayer,
  scoreState,
} from "../../../packages/core/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function boardBytes(state) {
  const bytes = Buffer.alloc(BOARD_SIZE * BOARD_SIZE);
  for (let i = 0; i < bytes.length; i += 1) {
    const cell = state.board[i];
    bytes[i] = cell < 0 ? 0 : cell + 1;
  }
  return bytes;
}

function stateBytes(state, player) {
  const tensor = encodeStateTensor(state, player); // Float32Array, plane->y->x order
  return Buffer.from(tensor.buffer, tensor.byteOffset, tensor.byteLength);
}

// Fully deterministic, language-reproducible move selection: pick the move at
// index (turn % moves.length) in generateLegalMoves order. This game exists only
// to pin down rule/encoder parity, not to be strong.
function deterministicGame(startPolicy, maxPlies = 200) {
  let state = createInitialState(startPolicy);
  const positions = [];
  let ply = 0;
  while (state.status === "playing" && ply < maxPlies) {
    const moves = generateLegalMoves(state);
    const moveIndex = state.turn % moves.length;
    const move = moves[moveIndex];
    const [scoreA, scoreB] = scoreState(state);
    positions.push({
      ply,
      turn: state.turn,
      currentPlayer: state.currentPlayer,
      legalMoveCount: moves.length,
      moveIndex,
      selectedAction: encodeAction(move),
      boardSha: sha256Hex(boardBytes(state)),
      stateShaCurrent: sha256Hex(stateBytes(state, state.currentPlayer)),
      scoreA,
      scoreB,
    });
    state = applyMove(state, move);
    ply += 1;
  }
  const [finalA, finalB] = scoreState(state);
  return {
    startPolicy,
    plies: positions.length,
    status: state.status,
    finalScoreA: finalA,
    finalScoreB: finalB,
    finalBoardSha: sha256Hex(boardBytes(state)),
    positions,
  };
}

function actionRoundTrips() {
  // A spread of action ids across orientations/positions plus pass, for both players.
  const ids = [0, 1, 195, 196, 197, 1207, 9000, ACTION_SIZE - 2, PASS_ACTION];
  return ids.map((action) => {
    const decoded0 = decodeAction(action, 0);
    const reencoded0 = encodeAction(decoded0);
    return { action, player: 0, decoded: decoded0, reencoded: reencoded0 };
  });
}

function scoringSamples() {
  // Exercise the scoring formula edge cases on a fixedStart blank state.
  const blankFinished = createInitialState("fixedStart");
  blankFinished.status = "finished";
  const allPlacedI1 = createInitialState("fixedStart");
  allPlacedI1.remainingPieces[0] = [];
  allPlacedI1.lastPlacedPiece[0] = "I1";
  const allPlacedI2 = createInitialState("fixedStart");
  allPlacedI2.remainingPieces[0] = [];
  allPlacedI2.lastPlacedPiece[0] = "I2";
  return {
    blankFinishedP0: scorePlayer(blankFinished, 0),
    allPlacedLastI1: scorePlayer(allPlacedI1, 0),
    allPlacedLastI2: scorePlayer(allPlacedI2, 0),
  };
}

const golden = {
  schemaVersion: 1,
  generatedBy: "training/native/parity/gen_golden.mjs",
  boardSize: BOARD_SIZE,
  orientationCount: ORIENTATIONS.length,
  actionSize: ACTION_SIZE,
  passAction: PASS_ACTION,
  startPoints: { A: { x: 4, y: 4 }, B: { x: 9, y: 9 } },
  initialLegalMoveCounts: {
    chooseStart: generateLegalMoves(createInitialState("chooseStart")).length,
    fixedStart: generateLegalMoves(createInitialState("fixedStart")).length,
  },
  actionRoundTrips: actionRoundTrips(),
  scoringSamples: scoringSamples(),
  deterministicGames: [deterministicGame("fixedStart"), deterministicGame("chooseStart")],
};

await mkdir(here, { recursive: true });
const outPath = `${here}/golden.json`;
await writeFile(outPath, `${JSON.stringify(golden, null, 2)}\n`);

const g = golden.deterministicGames[0];
console.log("Wrote", outPath);
console.log("  orientationCount:", golden.orientationCount, "| actionSize:", golden.actionSize, "| passAction:", golden.passAction);
console.log("  initialLegalMoves:", golden.initialLegalMoveCounts);
console.log("  scoringSamples:", golden.scoringSamples);
console.log(`  fixedStart game: ${g.plies} plies, status=${g.status}, final=${g.finalScoreA} vs ${g.finalScoreB}`);
