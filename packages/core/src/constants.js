export const BOARD_SIZE = 14;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const EMPTY = -1;

// Official Blokus Duo start cells on a 14x14 board: the two highlighted interior
// squares at (4,4) and (9,9) (symmetric about the center), NOT the board corners.
export const START_POINTS = {
  A: { id: "A", x: 4, y: 4 },
  B: { id: "B", x: 9, y: 9 },
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
