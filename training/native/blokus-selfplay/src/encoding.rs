//! Mirror of `packages/core/src/stateEncoding.js`.
//!
//! Produces 51 planes of 14x14 (all values 0.0/1.0), flattened in plane(0..51) ->
//! y(0..14) -> x(0..14) order as `f32`. EVERYTHING is from `player`'s perspective via
//! `normalize_coord`: player 0 sees the board as-is; player 1 sees it rotated 180°
//! ((x,y) -> (13-x, 13-y)). Parity-critical — must match JS/Python encoders exactly.
//!
//! Planes:
//!   0   my cells
//!   1   opponent cells
//!   2   empty cells
//!   3   my corner-candidates
//!   4   opponent corner-candidates
//!   5   my forbidden-edge cells
//!   6   opponent forbidden-edge cells
//!   7   my start cell
//!   8   opponent start cell
//!   9..30  my remaining-piece planes (per PIECE_IDS index; all-1 if I still hold it)
//!   30..51 opponent remaining-piece planes

use std::collections::HashSet;

use crate::board::get_cell;
use crate::constants::{BOARD_SIZE, DIAGONAL_DIRS, EMPTY, ORTHOGONAL_DIRS, STATE_PLANES};
use crate::orientation::PIECE_IDS;
use crate::rules::{GameState, StartId};

fn other_player(player: u8) -> u8 {
    if player == 0 {
        1
    } else {
        0
    }
}

/// `normalizeCoord(player, x, y)`. For player 1 the board is viewed rotated 180°.
fn normalize_coord(player: u8, x: i32, y: i32) -> (i32, i32) {
    if player == 0 {
        (x, y)
    } else {
        (BOARD_SIZE as i32 - 1 - x, BOARD_SIZE as i32 - 1 - y)
    }
}

/// Board value at perspective-space (x, y). Returns `None` off-board (JS getCell ->
/// null), matching the reference comparisons against owner / EMPTY.
fn normalized_board_cell(state: &GameState, perspective_player: u8, x: i32, y: i32) -> Option<i8> {
    let (sx, sy) = normalize_coord(perspective_player, x, y);
    get_cell(&state.board, sx, sy)
}

/// `startPointForPerspective(player, owner)`: owner uses START A if owner==player else
/// START B; then if owner==1 the absolute point is mirrored to (13-x, 13-y).
fn start_point_for_perspective(player: u8, owner: u8) -> (i32, i32) {
    let (px, py) = if owner == player {
        StartId::A.point()
    } else {
        StartId::B.point()
    };
    let (px, py) = (px as i32, py as i32);
    if owner == 0 {
        (px, py)
    } else {
        (BOARD_SIZE as i32 - 1 - px, BOARD_SIZE as i32 - 1 - py)
    }
}

/// `computeCornerCandidates`. Special case (matches JS): if the owner has placed no
/// pieces, the only candidate is that owner's start cell in this perspective.
fn compute_corner_candidates(
    state: &GameState,
    perspective_player: u8,
    owner: u8,
) -> HashSet<(i32, i32)> {
    let mut cells: HashSet<(i32, i32)> = HashSet::new();

    if state.placed_pieces[owner as usize].is_empty() {
        cells.insert(start_point_for_perspective(perspective_player, owner));
        return cells;
    }

    let owner_i8 = owner as i8;
    let size = BOARD_SIZE as i32;
    for y in 0..size {
        for x in 0..size {
            if normalized_board_cell(state, perspective_player, x, y) != Some(owner_i8) {
                continue;
            }
            for &(dx, dy) in &DIAGONAL_DIRS {
                let cx = x + dx;
                let cy = y + dy;
                if cx < 0 || cy < 0 || cx >= size || cy >= size {
                    continue;
                }
                if normalized_board_cell(state, perspective_player, cx, cy) != Some(EMPTY) {
                    continue;
                }
                let mut edge_blocked = false;
                for &(ex, ey) in &ORTHOGONAL_DIRS {
                    if normalized_board_cell(state, perspective_player, cx + ex, cy + ey)
                        == Some(owner_i8)
                    {
                        edge_blocked = true;
                        break;
                    }
                }
                if !edge_blocked {
                    cells.insert((cx, cy));
                }
            }
        }
    }

    cells
}

/// `computeForbiddenEdgeCells`: empty cells orthogonally adjacent to an owner cell.
fn compute_forbidden_edge_cells(
    state: &GameState,
    perspective_player: u8,
    owner: u8,
) -> HashSet<(i32, i32)> {
    let mut cells: HashSet<(i32, i32)> = HashSet::new();
    let owner_i8 = owner as i8;
    let size = BOARD_SIZE as i32;
    for y in 0..size {
        for x in 0..size {
            if normalized_board_cell(state, perspective_player, x, y) != Some(owner_i8) {
                continue;
            }
            for &(dx, dy) in &ORTHOGONAL_DIRS {
                let cx = x + dx;
                let cy = y + dy;
                if cx < 0 || cy < 0 || cx >= size || cy >= size {
                    continue;
                }
                if normalized_board_cell(state, perspective_player, cx, cy) == Some(EMPTY) {
                    cells.insert((cx, cy));
                }
            }
        }
    }
    cells
}

/// 3D plane representation: `planes[plane][y][x]`, values 0.0/1.0.
pub fn encode_state_planes(state: &GameState, player: u8) -> Vec<Vec<Vec<f32>>> {
    let size = BOARD_SIZE;
    let mut planes =
        vec![vec![vec![0.0f32; size]; size]; STATE_PLANES];

    let opponent = other_player(player);
    let my_corners = compute_corner_candidates(state, player, player);
    let opp_corners = compute_corner_candidates(state, player, opponent);
    let my_forbidden = compute_forbidden_edge_cells(state, player, player);
    let opp_forbidden = compute_forbidden_edge_cells(state, player, opponent);
    let my_start = start_point_for_perspective(player, player);
    let opp_start = start_point_for_perspective(player, opponent);

    let player_i8 = player as i8;
    let opponent_i8 = opponent as i8;

    for y in 0..size {
        for x in 0..size {
            let xi = x as i32;
            let yi = y as i32;
            let value = normalized_board_cell(state, player, xi, yi);
            planes[0][y][x] = bin(value == Some(player_i8));
            planes[1][y][x] = bin(value == Some(opponent_i8));
            planes[2][y][x] = bin(value == Some(EMPTY));
            planes[3][y][x] = bin(my_corners.contains(&(xi, yi)));
            planes[4][y][x] = bin(opp_corners.contains(&(xi, yi)));
            planes[5][y][x] = bin(my_forbidden.contains(&(xi, yi)));
            planes[6][y][x] = bin(opp_forbidden.contains(&(xi, yi)));
            planes[7][y][x] = bin(xi == my_start.0 && yi == my_start.1);
            planes[8][y][x] = bin(xi == opp_start.0 && yi == opp_start.1);
        }
    }

    for (index, piece_id) in PIECE_IDS.iter().enumerate() {
        let my_has = state.remaining_pieces[player as usize]
            .iter()
            .any(|p| p == piece_id);
        let opp_has = state.remaining_pieces[opponent as usize]
            .iter()
            .any(|p| p == piece_id);
        let my_val = bin(my_has);
        let opp_val = bin(opp_has);
        for y in 0..size {
            for x in 0..size {
                planes[9 + index][y][x] = my_val;
                planes[30 + index][y][x] = opp_val;
            }
        }
    }

    planes
}

#[inline]
fn bin(b: bool) -> f32 {
    if b {
        1.0
    } else {
        0.0
    }
}

/// Flattened tensor of length `STATE_PLANES * BOARD_SIZE * BOARD_SIZE` (51*14*14 =
/// 9996) in plane -> y -> x order. Mirrors `encodeStateTensor`.
pub fn encode_state_tensor(state: &GameState, player: u8) -> Vec<f32> {
    let planes = encode_state_planes(state, player);
    let mut out = Vec::with_capacity(STATE_PLANES * BOARD_SIZE * BOARD_SIZE);
    for plane in &planes {
        for row in plane {
            for &v in row {
                out.push(v);
            }
        }
    }
    out
}
