//! Mirror of `packages/core/src/scoring.js`.
//!
//! scorePlayer = -(sum of remaining piece sizes)
//!               + 15 if remainingPieces empty (completion bonus)
//!               +  5 if completed AND lastPlacedPiece === "I1" (monomino-last bonus)

use crate::orientation::get_orientations_for_piece;
use crate::rules::GameState;

/// Number of unit squares in a piece. Mirrors `pieceSize` (PIECE_SHAPES[id].length).
/// Every orientation of a piece has the same `unit_squares`, so we read it from the
/// piece's first orientation in `orientations.json` rather than hardcoding sizes.
pub fn piece_size(piece_id: &str) -> u32 {
    get_orientations_for_piece(piece_id)
        .first()
        .map(|o| o.unit_squares)
        .unwrap_or(0)
}

pub fn remaining_unit_squares(state: &GameState, player: u8) -> i32 {
    state.remaining_pieces[player as usize]
        .iter()
        .map(|p| piece_size(p) as i32)
        .sum()
}

pub fn score_player(state: &GameState, player: u8) -> i32 {
    let remaining = remaining_unit_squares(state, player);
    let completed = state.remaining_pieces[player as usize].is_empty();
    let completion_bonus = if completed { 15 } else { 0 };
    let monomino_last_bonus =
        if completed && state.last_placed_piece[player as usize].as_deref() == Some("I1") {
            5
        } else {
            0
        };
    -remaining + completion_bonus + monomino_last_bonus
}

/// `[scoreP0, scoreP1]`. Mirrors `scoreState`.
pub fn score_state(state: &GameState) -> [i32; 2] {
    [score_player(state, 0), score_player(state, 1)]
}
