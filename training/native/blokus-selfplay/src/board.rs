//! Mirror of `packages/core/src/board.js`.
//!
//! The board is a flat row-major array of 196 cells: `index = y * BOARD_SIZE + x`.
//! Empty cells hold `EMPTY` (-1); occupied cells hold the owning player id (0 or 1).

use crate::constants::{BOARD_CELLS, BOARD_SIZE, EMPTY};

pub type Board = [i8; BOARD_CELLS];

pub fn create_empty_board() -> Board {
    [EMPTY; BOARD_CELLS]
}

#[inline]
pub fn cell_index(x: usize, y: usize) -> usize {
    y * BOARD_SIZE + x
}

#[inline]
pub fn in_bounds(x: i32, y: i32) -> bool {
    x >= 0 && y >= 0 && (x as usize) < BOARD_SIZE && (y as usize) < BOARD_SIZE
}

/// Returns the cell value, or `None` if out of bounds (mirrors JS `getCell` returning
/// `null` off-board — callers compare against player id / EMPTY, both of which differ
/// from `None`).
#[inline]
pub fn get_cell(board: &Board, x: i32, y: i32) -> Option<i8> {
    if !in_bounds(x, y) {
        return None;
    }
    Some(board[cell_index(x as usize, y as usize)])
}

#[inline]
pub fn set_cell(board: &mut Board, x: usize, y: usize, value: i8) {
    board[cell_index(x, y)] = value;
}

#[inline]
pub fn is_board_cell_empty(board: &Board, x: i32, y: i32) -> bool {
    get_cell(board, x, y) == Some(EMPTY)
}
