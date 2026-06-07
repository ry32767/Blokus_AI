import {
  BOARD_SIZE,
  DIAGONAL_DIRS,
  EMPTY,
  ORTHOGONAL_DIRS,
  START_POINTS,
} from "./constants.js";
import { getCell } from "./board.js";
import { PIECE_IDS } from "./pieceIds.js";

export const STATE_PLANES = 51;

function otherPlayer(player) {
  return player === 0 ? 1 : 0;
}

function normalizeCoord(player, x, y) {
  if (player === 0) return { x, y };
  return { x: BOARD_SIZE - 1 - x, y: BOARD_SIZE - 1 - y };
}

function normalizedBoardCell(state, player, x, y) {
  const coord = normalizeCoord(player, x, y);
  return getCell(state.board, coord.x, coord.y);
}

function fillBinaryPlane(planes, planeIndex, predicate) {
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      planes[planeIndex][y][x] = predicate(x, y) ? 1 : 0;
    }
  }
}

function startPointForPerspective(player, owner) {
  const point = owner === player ? START_POINTS.A : START_POINTS.B;
  return owner === 0
    ? point
    : { x: BOARD_SIZE - 1 - point.x, y: BOARD_SIZE - 1 - point.y };
}

function computeCornerCandidates(state, perspectivePlayer, owner) {
  const cells = new Set();

  if (state.placedPieces[owner].length === 0) {
    const start = startPointForPerspective(perspectivePlayer, owner);
    cells.add(`${start.x},${start.y}`);
    return cells;
  }

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (normalizedBoardCell(state, perspectivePlayer, x, y) !== owner) continue;

      for (const [dx, dy] of DIAGONAL_DIRS) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= BOARD_SIZE || cy >= BOARD_SIZE) continue;
        if (normalizedBoardCell(state, perspectivePlayer, cx, cy) !== EMPTY) continue;

        let edgeBlocked = false;
        for (const [ex, ey] of ORTHOGONAL_DIRS) {
          if (normalizedBoardCell(state, perspectivePlayer, cx + ex, cy + ey) === owner) {
            edgeBlocked = true;
            break;
          }
        }
        if (!edgeBlocked) cells.add(`${cx},${cy}`);
      }
    }
  }

  return cells;
}

function computeForbiddenEdgeCells(state, perspectivePlayer, owner) {
  const cells = new Set();

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (normalizedBoardCell(state, perspectivePlayer, x, y) !== owner) continue;
      for (const [dx, dy] of ORTHOGONAL_DIRS) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= BOARD_SIZE || cy >= BOARD_SIZE) continue;
        if (normalizedBoardCell(state, perspectivePlayer, cx, cy) === EMPTY) {
          cells.add(`${cx},${cy}`);
        }
      }
    }
  }

  return cells;
}

export function encodeState(state, player = state.currentPlayer) {
  const planes = Array.from({ length: STATE_PLANES }, () => (
    Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => 0))
  ));
  const opponent = otherPlayer(player);
  const myCorners = computeCornerCandidates(state, player, player);
  const oppCorners = computeCornerCandidates(state, player, opponent);
  const myForbidden = computeForbiddenEdgeCells(state, player, player);
  const oppForbidden = computeForbiddenEdgeCells(state, player, opponent);
  const myStart = startPointForPerspective(player, player);
  const oppStart = startPointForPerspective(player, opponent);

  fillBinaryPlane(planes, 0, (x, y) => normalizedBoardCell(state, player, x, y) === player);
  fillBinaryPlane(planes, 1, (x, y) => normalizedBoardCell(state, player, x, y) === opponent);
  fillBinaryPlane(planes, 2, (x, y) => normalizedBoardCell(state, player, x, y) === EMPTY);
  fillBinaryPlane(planes, 3, (x, y) => myCorners.has(`${x},${y}`));
  fillBinaryPlane(planes, 4, (x, y) => oppCorners.has(`${x},${y}`));
  fillBinaryPlane(planes, 5, (x, y) => myForbidden.has(`${x},${y}`));
  fillBinaryPlane(planes, 6, (x, y) => oppForbidden.has(`${x},${y}`));
  fillBinaryPlane(planes, 7, (x, y) => x === myStart.x && y === myStart.y);
  fillBinaryPlane(planes, 8, (x, y) => x === oppStart.x && y === oppStart.y);

  for (let index = 0; index < PIECE_IDS.length; index += 1) {
    const pieceId = PIECE_IDS[index];
    const myHasPiece = state.remainingPieces[player].includes(pieceId);
    const oppHasPiece = state.remainingPieces[opponent].includes(pieceId);
    fillBinaryPlane(planes, 9 + index, () => myHasPiece);
    fillBinaryPlane(planes, 30 + index, () => oppHasPiece);
  }

  return planes;
}

export function flattenStatePlanes(planes) {
  return Float32Array.from(
    planes.flatMap((plane) => plane.flatMap((row) => row)),
  );
}

export function encodeStateTensor(state, player = state.currentPlayer) {
  return flattenStatePlanes(encodeState(state, player));
}
