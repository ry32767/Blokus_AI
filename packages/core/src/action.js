import { BOARD_SIZE } from "./constants.js";
import { ACTION_SIZE, PASS_ACTION } from "./actionSpace.js";
import { ORIENTATIONS } from "./orientation.js";

export function encodeAction(move) {
  if (move.kind === "pass") return PASS_ACTION;
  return move.orientationGlobalId * BOARD_SIZE * BOARD_SIZE + move.y * BOARD_SIZE + move.x;
}

export function decodeAction(action, player) {
  if (action === PASS_ACTION) return { kind: "pass", player };
  if (action < 0 || action >= ACTION_SIZE) {
    throw new Error(`Action out of range: ${action}`);
  }
  const orientationGlobalId = Math.floor(action / (BOARD_SIZE * BOARD_SIZE));
  const position = action % (BOARD_SIZE * BOARD_SIZE);
  const orientation = ORIENTATIONS[orientationGlobalId];
  return {
    kind: "place",
    player,
    pieceId: orientation.pieceId,
    orientationGlobalId,
    x: position % BOARD_SIZE,
    y: Math.floor(position / BOARD_SIZE),
  };
}

export function legalMaskFromMoves(moves) {
  const mask = new Uint8Array(ACTION_SIZE);
  for (const move of moves) {
    mask[encodeAction(move)] = 1;
  }
  return mask;
}
