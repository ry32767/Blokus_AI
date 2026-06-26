//! Mirror of `packages/core/src/orientation.js` + `pieceIds.js`.
//!
//! Orientations are NOT hardcoded; they are loaded from the single source of truth
//! `packages/core/src/orientations.json` at runtime. The file lists 91 orientations,
//! one per (piece, distinct rotation/reflection). `globalId` equals the array index.

use std::sync::OnceLock;

use serde::Deserialize;

/// Canonical piece order. Index in this array is the "piece index" used by the
/// remaining-piece planes (planes 9..30 / 30..51) of the state encoder. Mirrors
/// `packages/core/src/pieceIds.js` exactly.
pub const PIECE_IDS: [&str; 21] = [
    "I1", "I2", "I3", "V3", "I4", "O4", "T4", "L4", "Z4", "F5", "I5", "L5", "P5", "T5", "U5", "V5",
    "W5", "X5", "Y5", "Z5", "N5",
];

/// Returns the index of `piece_id` within `PIECE_IDS`, or `None` if unknown.
pub fn piece_index(piece_id: &str) -> Option<usize> {
    PIECE_IDS.iter().position(|&p| p == piece_id)
}

#[derive(Debug, Clone, Deserialize)]
pub struct Orientation {
    #[serde(rename = "pieceId")]
    pub piece_id: String,
    #[serde(rename = "localId")]
    pub local_id: u32,
    #[serde(rename = "globalId")]
    pub global_id: u32,
    /// Cell offsets `[dx, dy]` relative to the placement anchor.
    pub cells: Vec<[i32; 2]>,
    pub width: i32,
    pub height: i32,
    #[serde(rename = "unitSquares")]
    pub unit_squares: u32,
}

static ORIENTATIONS: OnceLock<Vec<Orientation>> = OnceLock::new();

/// The raw JSON, embedded at compile time so the binary/tests do not depend on the
/// working directory or the JSON file being present at run time. The path is
/// resolved relative to `CARGO_MANIFEST_DIR` (the crate dir) at COMPILE time:
///   training/native/blokus-selfplay -> ../../../packages/core/src/orientations.json
const ORIENTATIONS_JSON: &str =
    include_str!("../../../../packages/core/src/orientations.json");

fn load() -> Vec<Orientation> {
    let list: Vec<Orientation> = serde_json::from_str(ORIENTATIONS_JSON)
        .expect("failed to parse packages/core/src/orientations.json");
    // Defensive parity check: globalId must equal the array index, matching the JS
    // ORIENTATIONS array semantics (action.js indexes ORIENTATIONS by globalId).
    for (i, o) in list.iter().enumerate() {
        assert_eq!(
            o.global_id as usize, i,
            "orientation globalId {} does not match array index {i}",
            o.global_id
        );
    }
    list
}

/// All orientations, indexed by `globalId`.
pub fn orientations() -> &'static [Orientation] {
    ORIENTATIONS.get_or_init(load).as_slice()
}

/// Total number of orientations (91).
pub fn orientation_count() -> usize {
    orientations().len()
}

/// Orientation by global id, or `None` if out of range.
pub fn get_orientation(global_id: usize) -> Option<&'static Orientation> {
    orientations().get(global_id)
}

/// Orientations belonging to `piece_id`, in `globalId` order (same as JS
/// `ORIENTATIONS_BY_PIECE`, which preserves array order via `filter`).
pub fn get_orientations_for_piece(piece_id: &str) -> Vec<&'static Orientation> {
    orientations()
        .iter()
        .filter(|o| o.piece_id == piece_id)
        .collect()
}
