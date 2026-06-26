//! Mirror of `packages/core/src/action.js` + `actionSpace.js`.
//!
//! Action encoding (must match the JS/Python action space exactly):
//!   place => orientationGlobalId * 196 + y * 14 + x
//!   pass  => PASS_ACTION (= 91 * 196 = 17836)
//!   ACTION_SIZE = 91 * 196 + 1 = 17837

use crate::constants::BOARD_SIZE;
use crate::orientation::{get_orientation, orientation_count};
use crate::rules::Move;

/// Number of board positions an orientation anchor can occupy (14 * 14 = 196).
pub fn num_board_positions() -> usize {
    BOARD_SIZE * BOARD_SIZE
}

/// 91 * 196 = 17836.
pub fn place_actions() -> usize {
    orientation_count() * num_board_positions()
}

/// The pass action id (= place_actions()).
pub fn pass_action() -> usize {
    place_actions()
}

/// Total action-space size (= place_actions() + 1).
pub fn action_size() -> usize {
    place_actions() + 1
}

/// Encode a move to its action id. Mirrors `encodeAction`.
pub fn encode_action(mv: &Move) -> usize {
    match mv {
        Move::Pass { .. } => pass_action(),
        Move::Place {
            orientation_global_id,
            x,
            y,
            ..
        } => orientation_global_id * BOARD_SIZE * BOARD_SIZE + y * BOARD_SIZE + x,
    }
}

/// Decode an action id (for `player`) back to a move. Mirrors `decodeAction`.
///
/// Panics on out-of-range action, like the JS implementation throws.
pub fn decode_action(action: usize, player: u8) -> Move {
    if action == pass_action() {
        return Move::Pass { player };
    }
    if action >= action_size() {
        panic!("Action out of range: {action}");
    }
    let positions = BOARD_SIZE * BOARD_SIZE;
    let orientation_global_id = action / positions;
    let position = action % positions;
    let orientation =
        get_orientation(orientation_global_id).expect("orientation id within range");
    Move::Place {
        player,
        piece_id: orientation.piece_id.clone(),
        orientation_global_id,
        x: position % BOARD_SIZE,
        y: position / BOARD_SIZE,
    }
}
