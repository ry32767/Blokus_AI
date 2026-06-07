from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List, Set, Tuple

import numpy as np


ROOT = Path(__file__).resolve().parent.parent
BOARD_SIZE = 14
EMPTY = -1
STATE_PLANES = 51
START_POINTS = {
    "A": {"x": 0, "y": 0},
    "B": {"x": BOARD_SIZE - 1, "y": BOARD_SIZE - 1},
}
ORTHOGONAL_DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))
DIAGONAL_DIRS = ((1, 1), (1, -1), (-1, 1), (-1, -1))
PIECE_IDS = [
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
]


def load_orientations() -> List[dict]:
    path = ROOT / "packages" / "core" / "src" / "orientations.json"
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


ORIENTATIONS = load_orientations()
ORIENTATION_COUNT = len(ORIENTATIONS)
PASS_ACTION = ORIENTATION_COUNT * BOARD_SIZE * BOARD_SIZE
ACTION_SIZE = PASS_ACTION + 1


def encode_action(move: dict) -> int:
    if move["kind"] == "pass":
        return PASS_ACTION
    return (
        int(move["orientationGlobalId"]) * BOARD_SIZE * BOARD_SIZE
        + int(move["y"]) * BOARD_SIZE
        + int(move["x"])
    )


def decode_action(action: int, player: int) -> dict:
    if action == PASS_ACTION:
        return {"kind": "pass", "player": player}
    if action < 0 or action >= ACTION_SIZE:
        raise ValueError(f"Action out of range: {action}")
    orientation_global_id = action // (BOARD_SIZE * BOARD_SIZE)
    position = action % (BOARD_SIZE * BOARD_SIZE)
    orientation = ORIENTATIONS[orientation_global_id]
    return {
        "kind": "place",
        "player": player,
        "pieceId": orientation["pieceId"],
        "orientationGlobalId": orientation_global_id,
        "x": position % BOARD_SIZE,
        "y": position // BOARD_SIZE,
    }


def _other_player(player: int) -> int:
    return 1 if player == 0 else 0


def _normalize_coord(player: int, x: int, y: int) -> Tuple[int, int]:
    if player == 0:
        return x, y
    return BOARD_SIZE - 1 - x, BOARD_SIZE - 1 - y


def _board_value(state: dict, perspective_player: int, x: int, y: int):
    if x < 0 or y < 0 or x >= BOARD_SIZE or y >= BOARD_SIZE:
        return None
    source_x, source_y = _normalize_coord(perspective_player, x, y)
    return state["board"][source_y * BOARD_SIZE + source_x]


def _start_point_for_perspective(player: int, owner: int) -> dict:
    point = START_POINTS["A"] if owner == player else START_POINTS["B"]
    if owner == 0:
        return point
    return {"x": BOARD_SIZE - 1 - point["x"], "y": BOARD_SIZE - 1 - point["y"]}


def _compute_corner_candidates(state: dict, perspective_player: int, owner: int) -> Set[Tuple[int, int]]:
    cells: Set[Tuple[int, int]] = set()
    if len(state["placedPieces"][owner]) == 0:
        start = _start_point_for_perspective(perspective_player, owner)
        cells.add((start["x"], start["y"]))
        return cells

    for y in range(BOARD_SIZE):
        for x in range(BOARD_SIZE):
            if _board_value(state, perspective_player, x, y) != owner:
                continue
            for dx, dy in DIAGONAL_DIRS:
                cx = x + dx
                cy = y + dy
                if cx < 0 or cy < 0 or cx >= BOARD_SIZE or cy >= BOARD_SIZE:
                    continue
                if _board_value(state, perspective_player, cx, cy) != EMPTY:
                    continue
                edge_blocked = False
                for ex, ey in ORTHOGONAL_DIRS:
                    if _board_value(state, perspective_player, cx + ex, cy + ey) == owner:
                        edge_blocked = True
                        break
                if not edge_blocked:
                    cells.add((cx, cy))
    return cells


def _compute_forbidden_edge_cells(state: dict, perspective_player: int, owner: int) -> Set[Tuple[int, int]]:
    cells: Set[Tuple[int, int]] = set()
    for y in range(BOARD_SIZE):
        for x in range(BOARD_SIZE):
            if _board_value(state, perspective_player, x, y) != owner:
                continue
            for dx, dy in ORTHOGONAL_DIRS:
                cx = x + dx
                cy = y + dy
                if cx < 0 or cy < 0 or cx >= BOARD_SIZE or cy >= BOARD_SIZE:
                    continue
                if _board_value(state, perspective_player, cx, cy) == EMPTY:
                    cells.add((cx, cy))
    return cells


def encode_state(state: dict, player: int | None = None) -> np.ndarray:
    if player is None:
        player = int(state["currentPlayer"])
    opponent = _other_player(player)
    tensor = np.zeros((STATE_PLANES, BOARD_SIZE, BOARD_SIZE), dtype=np.float32)
    my_corners = _compute_corner_candidates(state, player, player)
    opp_corners = _compute_corner_candidates(state, player, opponent)
    my_forbidden = _compute_forbidden_edge_cells(state, player, player)
    opp_forbidden = _compute_forbidden_edge_cells(state, player, opponent)
    my_start = _start_point_for_perspective(player, player)
    opp_start = _start_point_for_perspective(player, opponent)

    for y in range(BOARD_SIZE):
        for x in range(BOARD_SIZE):
            value = _board_value(state, player, x, y)
            tensor[0, y, x] = 1.0 if value == player else 0.0
            tensor[1, y, x] = 1.0 if value == opponent else 0.0
            tensor[2, y, x] = 1.0 if value == EMPTY else 0.0
            tensor[3, y, x] = 1.0 if (x, y) in my_corners else 0.0
            tensor[4, y, x] = 1.0 if (x, y) in opp_corners else 0.0
            tensor[5, y, x] = 1.0 if (x, y) in my_forbidden else 0.0
            tensor[6, y, x] = 1.0 if (x, y) in opp_forbidden else 0.0
            tensor[7, y, x] = 1.0 if x == my_start["x"] and y == my_start["y"] else 0.0
            tensor[8, y, x] = 1.0 if x == opp_start["x"] and y == opp_start["y"] else 0.0

    for index, piece_id in enumerate(PIECE_IDS):
        tensor[9 + index, :, :] = 1.0 if piece_id in state["remainingPieces"][player] else 0.0
        tensor[30 + index, :, :] = 1.0 if piece_id in state["remainingPieces"][opponent] else 0.0

    return tensor
