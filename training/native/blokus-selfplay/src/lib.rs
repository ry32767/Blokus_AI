//! Native (Rust) Blokus Duo deterministic core + self-play scaffold.
//!
//! This crate is a parity-verified port of the JavaScript reference in
//! `packages/core/src/*.js` (and the Python mirror in `training/blokus_shared.py`).
//! It exists to drive FAST local self-play that will eventually replace the slow
//! Node + onnxruntime-web path. For now it provides only the CORRECT, deterministic
//! rules + encoders + a random-legal self-play scaffold; neural-network inference and
//! PUCT MCTS are the next milestones (see README).
//!
//! Parity is the #1 requirement: see `tests/parity.rs`, which validates this core
//! against `training/native/parity/golden.json`.

pub mod action;
pub mod board;
pub mod constants;
pub mod encoding;
pub mod inference;
pub mod mcts;
pub mod orientation;
pub mod rules;
pub mod scoring;

// ---- Public API mirroring the JS core ----

pub use action::{action_size, decode_action, encode_action, pass_action};
pub use board::Board;
pub use constants::{BOARD_SIZE, EMPTY};
pub use encoding::{encode_state_planes, encode_state_tensor};
pub use inference::{PolicyValue, UniformPolicyValue, STATE_TENSOR_LEN};
pub use mcts::{Mcts, MctsConfig, MctsResult, SplitMix64};

#[cfg(feature = "onnx")]
pub use inference::OnnxPolicyValue;
pub use orientation::{
    get_orientation, get_orientations_for_piece, orientation_count, orientations, piece_index,
    Orientation, PIECE_IDS,
};
pub use rules::{
    apply_move, create_initial_state, generate_legal_moves,
    generate_legal_placements_for_player, is_legal_placement, is_terminal, GameState, Move,
    StartId, StartPolicy, Status,
};
pub use scoring::{piece_size, score_player, score_state};
