import { BOARD_CELLS, BOARD_SIZE, EMPTY } from "./constants.js";

export function createEmptyBoard() {
  return Array.from({ length: BOARD_CELLS }, () => EMPTY);
}

export function cellIndex(x, y) {
  return y * BOARD_SIZE + x;
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

export function getCell(board, x, y) {
  if (!inBounds(x, y)) return null;
  return board[cellIndex(x, y)];
}

export function setCell(board, x, y, value) {
  board[cellIndex(x, y)] = value;
}

export function isBoardCellEmpty(board, x, y) {
  return getCell(board, x, y) === EMPTY;
}

export function cloneBoard(board) {
  return Array.from(board);
}
