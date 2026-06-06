import {
  BOARD_SIZE,
  DIAGONAL_DIRS,
  EMPTY,
  ORTHOGONAL_DIRS,
  PIECE_IDS,
  START_POINTS,
} from "./constants.js";
import { cellIndex, cloneBoard, createEmptyBoard, getCell, inBounds, isBoardCellEmpty, setCell } from "./board.js";
import { getOrientation, getOrientations } from "./orientation.js";
import { scoreState } from "./scoring.js";

export function other(player) {
  return player === 0 ? 1 : 0;
}

export function createInitialState(startPolicy = "chooseStart") {
  return {
    board: createEmptyBoard(),
    currentPlayer: 0,
    turn: 0,
    status: "playing",
    startPolicy,
    startAssignment: startPolicy === "fixedStart" ? ["A", "B"] : [null, null],
    remainingPieces: [PIECE_IDS.slice(), PIECE_IDS.slice()],
    placedPieces: [[], []],
    lastPlacedPiece: [null, null],
    forcedPassed: [false, false],
    consecutivePasses: 0,
    moveHistory: [],
  };
}

export function cloneState(state) {
  return {
    ...state,
    board: cloneBoard(state.board),
    startAssignment: state.startAssignment.slice(),
    remainingPieces: [state.remainingPieces[0].slice(), state.remainingPieces[1].slice()],
    placedPieces: [state.placedPieces[0].slice(), state.placedPieces[1].slice()],
    lastPlacedPiece: state.lastPlacedPiece.slice(),
    forcedPassed: state.forcedPassed.slice(),
    moveHistory: state.moveHistory.map((record) => structuredClone(record)),
  };
}

export function getCellsForMove(move) {
  if (move.kind !== "place") return [];
  const orientation = getOrientation(move.orientationGlobalId);
  if (!orientation) return [];
  return orientation.cells.map(([dx, dy]) => ({ x: move.x + dx, y: move.y + dy }));
}

export function coversStartPoint(cells, startPointId) {
  const start = START_POINTS[startPointId];
  return cells.some((cell) => cell.x === start.x && cell.y === start.y);
}

export function getRequiredStartPointForFirstMove(state, player) {
  if (state.startPolicy === "fixedStart") {
    return { kind: "specific", id: player === 0 ? "A" : "B" };
  }
  const assigned = state.startAssignment[player];
  if (assigned) return { kind: "specific", id: assigned };
  return { kind: "any" };
}

export function explainPlacement(state, move) {
  if (state.status !== "playing") return { legal: false, reason: "Game is finished." };
  if (move.kind !== "place") return { legal: false, reason: "Pass is not a placement." };
  const player = state.currentPlayer;
  if (move.player !== player) return { legal: false, reason: "It is not that player's turn." };
  if (!state.remainingPieces[player].includes(move.pieceId)) {
    return { legal: false, reason: "That piece has already been placed." };
  }

  const orientation = getOrientation(move.orientationGlobalId);
  if (!orientation || orientation.pieceId !== move.pieceId) {
    return { legal: false, reason: "The selected orientation does not match the piece." };
  }

  const cells = getCellsForMove(move);
  for (const cell of cells) {
    if (!inBounds(cell.x, cell.y)) return { legal: false, reason: "The piece would leave the board." };
    if (!isBoardCellEmpty(state.board, cell.x, cell.y)) {
      return { legal: false, reason: "The piece overlaps an occupied cell." };
    }
  }

  const isFirstMoveOfPlayer = state.placedPieces[player].length === 0;
  if (isFirstMoveOfPlayer) {
    const requiredStart = getRequiredStartPointForFirstMove(state, player);
    if (requiredStart.kind === "any") {
      const legal = coversStartPoint(cells, "A") || coversStartPoint(cells, "B");
      return legal
        ? { legal: true, reason: "Legal." }
        : { legal: false, reason: "The first move must cover one start point." };
    }
    return coversStartPoint(cells, requiredStart.id)
      ? { legal: true, reason: "Legal." }
      : { legal: false, reason: `The first move must cover start ${requiredStart.id}.` };
  }

  for (const cell of cells) {
    for (const [dx, dy] of ORTHOGONAL_DIRS) {
      if (getCell(state.board, cell.x + dx, cell.y + dy) === player) {
        return { legal: false, reason: "Same-color edge contact is not allowed." };
      }
    }
  }

  let touchesOwnCorner = false;
  for (const cell of cells) {
    for (const [dx, dy] of DIAGONAL_DIRS) {
      if (getCell(state.board, cell.x + dx, cell.y + dy) === player) {
        touchesOwnCorner = true;
      }
    }
  }

  return touchesOwnCorner
    ? { legal: true, reason: "Legal." }
    : { legal: false, reason: "The piece must touch one of your pieces by a corner." };
}

export function isLegalPlacement(state, move) {
  return explainPlacement(state, move).legal;
}

export function toMove(player, pieceId, orientationGlobalId, x, y) {
  return { kind: "place", player, pieceId, orientationGlobalId, x, y };
}

export function generateLegalPlacementsForPlayer(state, player) {
  if (state.status !== "playing") return [];
  const scopedState = state.currentPlayer === player ? state : { ...state, currentPlayer: player };
  const moves = [];

  for (const pieceId of scopedState.remainingPieces[player]) {
    for (const orientation of getOrientations(pieceId)) {
      for (let y = 0; y < BOARD_SIZE; y += 1) {
        for (let x = 0; x < BOARD_SIZE; x += 1) {
          const move = toMove(player, pieceId, orientation.globalId, x, y);
          if (isLegalPlacement(scopedState, move)) moves.push(move);
        }
      }
    }
  }

  return moves;
}

export function generateLegalMoves(state) {
  if (state.status !== "playing") return [];
  const player = state.currentPlayer;
  const moves = generateLegalPlacementsForPlayer(state, player);
  return moves.length > 0 ? moves : [{ kind: "pass", player }];
}

export function sameMove(a, b) {
  if (a.kind !== b.kind || a.player !== b.player) return false;
  if (a.kind === "pass") return true;
  return (
    a.pieceId === b.pieceId &&
    a.orientationGlobalId === b.orientationGlobalId &&
    a.x === b.x &&
    a.y === b.y
  );
}

export function isLegalMove(state, move) {
  return generateLegalMoves(state).some((candidate) => sameMove(candidate, move));
}

function removePiece(pieceList, pieceId) {
  const index = pieceList.indexOf(pieceId);
  if (index >= 0) pieceList.splice(index, 1);
}

function updateStartAssignmentAfterFirstMove(state, player, cells) {
  if (state.startPolicy !== "chooseStart") return;
  if (state.startAssignment[player]) return;
  const chosen = coversStartPoint(cells, "A") ? "A" : "B";
  state.startAssignment[player] = chosen;
  state.startAssignment[other(player)] = chosen === "A" ? "B" : "A";
}

function hasLegalPlacement(state, player) {
  return generateLegalPlacementsForPlayer(state, player).length > 0;
}

export function isTerminal(state) {
  if (state.remainingPieces[0].length === 0 && state.remainingPieces[1].length === 0) return true;
  return !hasLegalPlacement(state, 0) && !hasLegalPlacement(state, 1);
}

export function advanceTurnOrFinish(state) {
  if (isTerminal(state)) {
    state.status = "finished";
    return;
  }
  state.currentPlayer = other(state.currentPlayer);
  state.turn += 1;
}

export function applyMove(state, move) {
  const legalMoves = generateLegalMoves(state);
  if (!legalMoves.some((candidate) => sameMove(candidate, move))) {
    throw new Error("Illegal move");
  }

  const next = cloneState(state);
  const record = {
    ply: state.turn,
    move: structuredClone(move),
    legalMoveCountBefore: legalMoves.length,
  };

  if (move.kind === "pass") {
    next.forcedPassed[move.player] = true;
    next.consecutivePasses += 1;
    next.moveHistory.push(record);
    advanceTurnOrFinish(next);
    record.scoreAfter = scoreState(next);
    return next;
  }

  const cells = getCellsForMove(move);
  for (const cell of cells) {
    setCell(next.board, cell.x, cell.y, move.player);
  }
  removePiece(next.remainingPieces[move.player], move.pieceId);
  next.placedPieces[move.player].push(move.pieceId);
  next.lastPlacedPiece[move.player] = move.pieceId;
  next.forcedPassed[move.player] = false;
  next.consecutivePasses = 0;

  if (next.placedPieces[move.player].length === 1) {
    updateStartAssignmentAfterFirstMove(next, move.player, cells);
  }

  next.moveHistory.push(record);
  advanceTurnOrFinish(next);
  record.scoreAfter = scoreState(next);
  return next;
}

export function occupiedCells(state, player = null) {
  const cells = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const value = state.board[cellIndex(x, y)];
      if (value !== EMPTY && (player === null || value === player)) cells.push({ x, y, player: value });
    }
  }
  return cells;
}
