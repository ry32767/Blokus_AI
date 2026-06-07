import { PIECE_IDS } from "./pieceIds.js";
import { ORIENTATIONS as GENERATED_ORIENTATIONS } from "./generatedOrientations.js";

export const ORIENTATIONS = GENERATED_ORIENTATIONS;

export const ORIENTATIONS_BY_PIECE = Object.fromEntries(
  PIECE_IDS.map((pieceId) => [
    pieceId,
    ORIENTATIONS.filter((orientation) => orientation.pieceId === pieceId),
  ]),
);

export function getOrientation(globalId) {
  return ORIENTATIONS[globalId] || null;
}

export function getOrientations(pieceId) {
  return ORIENTATIONS_BY_PIECE[pieceId] || [];
}
