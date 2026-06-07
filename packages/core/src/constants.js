export const BOARD_SIZE = 14;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const EMPTY = -1;

export const START_POINTS = {
  A: { id: "A", x: 0, y: 0 },
  B: { id: "B", x: 13, y: 13 },
};

export const PLAYERS = [
  { id: 0, label: "Black" },
  { id: 1, label: "White" },
];

export const ORTHOGONAL_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const DIAGONAL_DIRS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
