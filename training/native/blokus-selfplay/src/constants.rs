//! Mirror of `packages/core/src/constants.js`.
//!
//! Parity-critical values. Changing any of these invalidates trained models and
//! breaks the golden parity vectors in `training/native/parity/golden.json`.

pub const BOARD_SIZE: usize = 14;
pub const BOARD_CELLS: usize = BOARD_SIZE * BOARD_SIZE; // 196

/// JS uses `-1` for an empty cell. We keep the board as `i8` so the same sentinel
/// applies; player ids are `0` and `1`.
pub const EMPTY: i8 = -1;

/// Official Blokus Duo start cells on a 14x14 board: the two highlighted interior
/// squares at (4,4) and (9,9) (symmetric about the center), NOT the board corners.
pub const START_A: (usize, usize) = (4, 4);
pub const START_B: (usize, usize) = (9, 9);

/// Orthogonal (edge) neighbour offsets, in the JS declaration order.
pub const ORTHOGONAL_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Diagonal (corner) neighbour offsets, in the JS declaration order.
pub const DIAGONAL_DIRS: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];

/// Number of state-encoding planes (see `encoding.rs`).
pub const STATE_PLANES: usize = 51;
