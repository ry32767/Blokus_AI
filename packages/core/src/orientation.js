import { PIECE_IDS } from "./constants.js";
import { PIECE_SHAPES } from "./pieces.js";

const TRANSFORMS = [
  ([x, y]) => [x, y],
  ([x, y]) => [x, -y],
  ([x, y]) => [-x, y],
  ([x, y]) => [-x, -y],
  ([x, y]) => [y, x],
  ([x, y]) => [y, -x],
  ([x, y]) => [-y, x],
  ([x, y]) => [-y, -x],
];

export function compareCells(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (!a[i]) return -1;
    if (!b[i]) return 1;
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
    if (a[i][0] !== b[i][0]) return a[i][0] - b[i][0];
  }
  return 0;
}

export function normalizeCells(cells) {
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells
    .map(([x, y]) => [x - minX, y - minY])
    .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

export function cellKey(cells) {
  return cells.map(([x, y]) => `${x},${y}`).join(";");
}

export function getPieceOrientations(pieceId) {
  const baseCells = PIECE_SHAPES[pieceId];
  const unique = new Map();

  for (const transform of TRANSFORMS) {
    const cells = normalizeCells(baseCells.map(transform));
    unique.set(cellKey(cells), cells);
  }

  return Array.from(unique.values())
    .sort(compareCells)
    .map((cells, localId) => ({
      pieceId,
      localId,
      globalId: -1,
      cells,
      width: Math.max(...cells.map(([x]) => x)) + 1,
      height: Math.max(...cells.map(([, y]) => y)) + 1,
      unitSquares: cells.length,
    }));
}

export const ORIENTATIONS = PIECE_IDS
  .flatMap((pieceId) => getPieceOrientations(pieceId))
  .map((orientation, globalId) => ({ ...orientation, globalId }));

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
