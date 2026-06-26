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

function normalizeCells(cells) {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells
    .map(([x, y]) => [x - minX, y - minY])
    .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function cellKey(cells) {
  return cells.map(([x, y]) => `${x},${y}`).join(";");
}

export function getFlippedOrientation(orientation) {
  if (!orientation) return null;

  const flippedKey = cellKey(normalizeCells(
    orientation.cells.map(([x, y]) => [orientation.width - 1 - x, y]),
  ));

  return getOrientations(orientation.pieceId).find(
    (candidate) => cellKey(normalizeCells(candidate.cells)) === flippedKey,
  ) || orientation;
}
