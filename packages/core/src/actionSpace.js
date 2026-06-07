import { BOARD_CELLS } from "./constants.js";
import { ORIENTATIONS } from "./orientation.js";

export const ORIENTATION_COUNT = ORIENTATIONS.length;
export const NUM_BOARD_POSITIONS = BOARD_CELLS;
export const PLACE_ACTIONS = ORIENTATION_COUNT * NUM_BOARD_POSITIONS;
export const PASS_ACTION = PLACE_ACTIONS;
export const ACTION_SIZE = PLACE_ACTIONS + 1;
