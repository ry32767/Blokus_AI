//! Mirror of `packages/core/src/rules.js`.
//!
//! Parity-critical. The legal-move ITERATION ORDER, first-move start coverage,
//! edge-vs-corner contact rules, and chooseStart assignment must match the JS
//! reference byte-for-byte (it drives action ids and the golden vectors).

use crate::board::{create_empty_board, get_cell, in_bounds, is_board_cell_empty, set_cell, Board};
use crate::constants::{DIAGONAL_DIRS, ORTHOGONAL_DIRS, START_A, START_B};
use crate::orientation::{get_orientation, get_orientations_for_piece, PIECE_IDS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartPolicy {
    ChooseStart,
    FixedStart,
}

impl StartPolicy {
    pub fn parse(s: &str) -> Option<StartPolicy> {
        match s {
            "chooseStart" => Some(StartPolicy::ChooseStart),
            "fixedStart" => Some(StartPolicy::FixedStart),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Playing,
    Finished,
}

/// Which start cell (A or B) a player is assigned. `None` until chosen under
/// chooseStart; always set under fixedStart.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartId {
    A,
    B,
}

impl StartId {
    pub fn point(self) -> (usize, usize) {
        match self {
            StartId::A => START_A,
            StartId::B => START_B,
        }
    }
    pub fn other(self) -> StartId {
        match self {
            StartId::A => StartId::B,
            StartId::B => StartId::A,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Move {
    Pass {
        player: u8,
    },
    Place {
        player: u8,
        piece_id: String,
        orientation_global_id: usize,
        x: usize,
        y: usize,
    },
}

impl Move {
    pub fn player(&self) -> u8 {
        match self {
            Move::Pass { player } => *player,
            Move::Place { player, .. } => *player,
        }
    }
}

/// The mutable game state, mirroring the JS plain-object shape used across the
/// reference implementation.
#[derive(Debug, Clone)]
pub struct GameState {
    pub board: Board,
    pub current_player: u8,
    pub turn: u32,
    pub status: Status,
    pub start_policy: StartPolicy,
    /// Per-player assigned start cell (index 0 = player 0).
    pub start_assignment: [Option<StartId>; 2],
    /// Remaining piece ids per player, in PIECE_IDS order (removed on placement).
    pub remaining_pieces: [Vec<String>; 2],
    /// Pieces placed per player, in placement order.
    pub placed_pieces: [Vec<String>; 2],
    pub last_placed_piece: [Option<String>; 2],
    pub forced_passed: [bool; 2],
    pub consecutive_passes: u32,
}

#[inline]
pub fn other(player: u8) -> u8 {
    if player == 0 {
        1
    } else {
        0
    }
}

pub fn create_initial_state(start_policy: StartPolicy) -> GameState {
    let start_assignment = match start_policy {
        StartPolicy::FixedStart => [Some(StartId::A), Some(StartId::B)],
        StartPolicy::ChooseStart => [None, None],
    };
    GameState {
        board: create_empty_board(),
        current_player: 0,
        turn: 0,
        status: Status::Playing,
        start_policy,
        start_assignment,
        remaining_pieces: [
            PIECE_IDS.iter().map(|s| s.to_string()).collect(),
            PIECE_IDS.iter().map(|s| s.to_string()).collect(),
        ],
        placed_pieces: [Vec::new(), Vec::new()],
        last_placed_piece: [None, None],
        forced_passed: [false, false],
        consecutive_passes: 0,
    }
}

/// Absolute board cells a placement move would occupy (`anchor + offset`).
/// Mirrors `getCellsForMove`.
pub fn get_cells_for_move(mv: &Move) -> Vec<(i32, i32)> {
    match mv {
        Move::Pass { .. } => Vec::new(),
        Move::Place {
            orientation_global_id,
            x,
            y,
            ..
        } => match get_orientation(*orientation_global_id) {
            None => Vec::new(),
            Some(o) => o
                .cells
                .iter()
                .map(|[dx, dy]| (*x as i32 + dx, *y as i32 + dy))
                .collect(),
        },
    }
}

fn covers_start_point(cells: &[(i32, i32)], start: StartId) -> bool {
    let (sx, sy) = start.point();
    cells.iter().any(|&(x, y)| x == sx as i32 && y == sy as i32)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RequiredStart {
    Specific(StartId),
    Any,
}

fn required_start_for_first_move(state: &GameState, player: u8) -> RequiredStart {
    if state.start_policy == StartPolicy::FixedStart {
        return RequiredStart::Specific(if player == 0 { StartId::A } else { StartId::B });
    }
    match state.start_assignment[player as usize] {
        Some(id) => RequiredStart::Specific(id),
        None => RequiredStart::Any,
    }
}

/// True if `mv` is a legal placement for `state.current_player` against the current
/// board. Mirrors `explainPlacement(...).legal`.
///
/// NOTE: like the JS, this evaluates relative to `state.current_player`; callers that
/// want to test another player's placements must scope the player first (see
/// `generate_legal_placements_for_player`).
pub fn is_legal_placement(state: &GameState, mv: &Move) -> bool {
    if state.status != Status::Playing {
        return false;
    }
    let (player, piece_id, orientation_global_id) = match mv {
        Move::Pass { .. } => return false,
        Move::Place {
            player,
            piece_id,
            orientation_global_id,
            ..
        } => (*player, piece_id, *orientation_global_id),
    };
    if player != state.current_player {
        return false;
    }
    if !state.remaining_pieces[player as usize]
        .iter()
        .any(|p| p == piece_id)
    {
        return false;
    }

    let orientation = match get_orientation(orientation_global_id) {
        Some(o) if &o.piece_id == piece_id => o,
        _ => return false,
    };
    let _ = orientation; // matched only for the pieceId consistency check above.

    let cells = get_cells_for_move(mv);
    for &(cx, cy) in &cells {
        if !in_bounds(cx, cy) {
            return false;
        }
        if !is_board_cell_empty(&state.board, cx, cy) {
            return false;
        }
    }

    let is_first_move = state.placed_pieces[player as usize].is_empty();
    if is_first_move {
        return match required_start_for_first_move(state, player) {
            RequiredStart::Any => {
                covers_start_point(&cells, StartId::A) || covers_start_point(&cells, StartId::B)
            }
            RequiredStart::Specific(id) => covers_start_point(&cells, id),
        };
    }

    // Non-first move: no same-color ORTHOGONAL edge contact ...
    let player_i8 = player as i8;
    for &(cx, cy) in &cells {
        for &(dx, dy) in &ORTHOGONAL_DIRS {
            if get_cell(&state.board, cx + dx, cy + dy) == Some(player_i8) {
                return false;
            }
        }
    }

    // ... AND must touch own color DIAGONALLY.
    let mut touches_own_corner = false;
    for &(cx, cy) in &cells {
        for &(dx, dy) in &DIAGONAL_DIRS {
            if get_cell(&state.board, cx + dx, cy + dy) == Some(player_i8) {
                touches_own_corner = true;
            }
        }
    }

    touches_own_corner
}

pub fn to_move(player: u8, piece_id: &str, orientation_global_id: usize, x: usize, y: usize) -> Move {
    Move::Place {
        player,
        piece_id: piece_id.to_string(),
        orientation_global_id,
        x,
        y,
    }
}

/// Generate every legal placement for `player`, in the EXACT JS iteration order:
///   for pieceId in remainingPieces[player] (PIECE_IDS order, preserved),
///     for orientation of that piece (globalId order),
///       for y in 0..14, for x in 0..14, push if legal.
pub fn generate_legal_placements_for_player(state: &GameState, player: u8) -> Vec<Move> {
    if state.status != Status::Playing {
        return Vec::new();
    }
    // Mirror JS: evaluate placements as if it were `player`'s turn.
    let scoped: std::borrow::Cow<GameState> = if state.current_player == player {
        std::borrow::Cow::Borrowed(state)
    } else {
        let mut s = state.clone();
        s.current_player = player;
        std::borrow::Cow::Owned(s)
    };
    let scoped: &GameState = &scoped;

    let mut moves = Vec::new();
    for piece_id in &scoped.remaining_pieces[player as usize] {
        for orientation in get_orientations_for_piece(piece_id) {
            for y in 0..crate::constants::BOARD_SIZE {
                for x in 0..crate::constants::BOARD_SIZE {
                    let mv = to_move(player, piece_id, orientation.global_id as usize, x, y);
                    if is_legal_placement(scoped, &mv) {
                        moves.push(mv);
                    }
                }
            }
        }
    }
    moves
}

/// Legal moves for the current player. If no placement exists, returns a single pass.
/// Mirrors `generateLegalMoves`.
pub fn generate_legal_moves(state: &GameState) -> Vec<Move> {
    if state.status != Status::Playing {
        return Vec::new();
    }
    let player = state.current_player;
    let moves = generate_legal_placements_for_player(state, player);
    if moves.is_empty() {
        vec![Move::Pass { player }]
    } else {
        moves
    }
}

fn has_legal_placement(state: &GameState, player: u8) -> bool {
    !generate_legal_placements_for_player(state, player).is_empty()
}

/// Mirrors `isTerminal`.
pub fn is_terminal(state: &GameState) -> bool {
    if state.remaining_pieces[0].is_empty() && state.remaining_pieces[1].is_empty() {
        return true;
    }
    !has_legal_placement(state, 0) && !has_legal_placement(state, 1)
}

fn remove_piece(piece_list: &mut Vec<String>, piece_id: &str) {
    if let Some(index) = piece_list.iter().position(|p| p == piece_id) {
        piece_list.remove(index);
    }
}

fn update_start_assignment_after_first_move(state: &mut GameState, player: u8, cells: &[(i32, i32)]) {
    if state.start_policy != StartPolicy::ChooseStart {
        return;
    }
    if state.start_assignment[player as usize].is_some() {
        return;
    }
    let chosen = if covers_start_point(cells, StartId::A) {
        StartId::A
    } else {
        StartId::B
    };
    state.start_assignment[player as usize] = Some(chosen);
    state.start_assignment[other(player) as usize] = Some(chosen.other());
}

fn advance_turn_or_finish(state: &mut GameState) {
    if is_terminal(state) {
        state.status = Status::Finished;
        return;
    }
    state.current_player = other(state.current_player);
    state.turn += 1;
}

fn same_move(a: &Move, b: &Move) -> bool {
    match (a, b) {
        (Move::Pass { player: pa }, Move::Pass { player: pb }) => pa == pb,
        (
            Move::Place {
                player: pa,
                piece_id: ia,
                orientation_global_id: oa,
                x: xa,
                y: ya,
            },
            Move::Place {
                player: pb,
                piece_id: ib,
                orientation_global_id: ob,
                x: xb,
                y: yb,
            },
        ) => pa == pb && ia == ib && oa == ob && xa == xb && ya == yb,
        _ => false,
    }
}

/// Apply a move, returning the next state. Mirrors `applyMove` (validates legality,
/// places cells, removes the piece, updates start assignment on the chooseStart first
/// move, advances/finishes the turn). Panics on illegal move, like the JS throws.
pub fn apply_move(state: &GameState, mv: &Move) -> GameState {
    let legal_moves = generate_legal_moves(state);
    if !legal_moves.iter().any(|c| same_move(c, mv)) {
        panic!("Illegal move");
    }

    let mut next = state.clone();

    if let Move::Pass { player } = mv {
        next.forced_passed[*player as usize] = true;
        next.consecutive_passes += 1;
        advance_turn_or_finish(&mut next);
        return next;
    }

    let cells = get_cells_for_move(mv);
    let (player, piece_id) = match mv {
        Move::Place {
            player, piece_id, ..
        } => (*player, piece_id.clone()),
        Move::Pass { .. } => unreachable!(),
    };

    for &(cx, cy) in &cells {
        // Cells are guaranteed in-bounds by the legality check above.
        set_cell(&mut next.board, cx as usize, cy as usize, player as i8);
    }
    remove_piece(&mut next.remaining_pieces[player as usize], &piece_id);
    next.placed_pieces[player as usize].push(piece_id.clone());
    next.last_placed_piece[player as usize] = Some(piece_id);
    next.forced_passed[player as usize] = false;
    next.consecutive_passes = 0;

    if next.placed_pieces[player as usize].len() == 1 {
        update_start_assignment_after_first_move(&mut next, player, &cells);
    }

    advance_turn_or_finish(&mut next);
    next
}
