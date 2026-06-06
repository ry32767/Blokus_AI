export const BOARD_SIZE = 14;
export const BOARD_CELLS = BOARD_SIZE * BOARD_SIZE;
export const EMPTY = -1;

export const START_POINTS = {
  A: { id: "A", x: 4, y: 4 },
  B: { id: "B", x: 9, y: 9 },
};

export const PLAYERS = [
  { id: 0, label: "Black" },
  { id: 1, label: "White" },
];

export const PIECE_IDS = [
  "I1",
  "I2",
  "I3",
  "V3",
  "I4",
  "O4",
  "T4",
  "L4",
  "Z4",
  "F5",
  "I5",
  "L5",
  "P5",
  "T5",
  "U5",
  "V5",
  "W5",
  "X5",
  "Y5",
  "Z5",
  "N5",
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

export const NUM_ORIENTATIONS = 91;
export const NUM_BOARD_POSITIONS = BOARD_CELLS;
export const PLACE_ACTIONS = NUM_ORIENTATIONS * NUM_BOARD_POSITIONS;
export const PASS_ACTION = PLACE_ACTIONS;
export const ACTION_SIZE = PLACE_ACTIONS + 1;
