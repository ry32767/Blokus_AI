import {
  BOARD_SIZE,
  DIAGONAL_DIRS,
  EMPTY,
  ORTHOGONAL_DIRS,
  applyMove,
  generateLegalMoves,
  getCell,
  getCellsForMove,
  scoreState,
} from "../../../../packages/core/src/index.js";
import { PIECE_SHAPES } from "../../../../packages/core/src/pieces.js";

function otherPlayer(player) {
  return player === 0 ? 1 : 0;
}

function pieceSize(pieceId) {
  return PIECE_SHAPES[pieceId].length;
}

export function cheapMoveOrderScore(move) {
  if (move.kind === "pass") return -1000;
  const cells = getCellsForMove(move);
  const centerBias = cells.reduce((sum, cell) => {
    const dx = Math.abs(cell.x - 6.5);
    const dy = Math.abs(cell.y - 6.5);
    return sum + (7 - Math.max(dx, dy));
  }, 0);
  return cells.length * 10 + centerBias;
}

function remainingUnitSquares(state, player) {
  return state.remainingPieces[player].reduce((sum, pieceId) => sum + pieceSize(pieceId), 0);
}

export function countCornerCandidates(state, player) {
  const seen = new Set();

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (getCell(state.board, x, y) !== player) continue;

      for (const [dx, dy] of DIAGONAL_DIRS) {
        const cx = x + dx;
        const cy = y + dy;
        if (getCell(state.board, cx, cy) !== EMPTY) continue;

        let edgeBlocked = false;
        for (const [ex, ey] of ORTHOGONAL_DIRS) {
          if (getCell(state.board, cx + ex, cy + ey) === player) {
            edgeBlocked = true;
            break;
          }
        }

        if (!edgeBlocked) {
          seen.add(`${cx},${cy}`);
        }
      }
    }
  }

  return seen.size;
}

export function countLegalPlacementsForPlayer(state, player) {
  if (state.status !== "playing") return 0;
  const scopedState = state.currentPlayer === player ? state : { ...state, currentPlayer: player };
  const legalMoves = generateLegalMoves(scopedState);
  return legalMoves.filter((move) => move.kind === "place").length;
}

function countOccupiedEdgeCells(state, player) {
  let count = 0;

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (getCell(state.board, x, y) !== player) continue;
      if (x === 0 || y === 0 || x === BOARD_SIZE - 1 || y === BOARD_SIZE - 1) {
        count += 1;
      }
    }
  }

  return count;
}

function centerAdvanceScoreForPlayer(state, player) {
  let score = 0;

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (getCell(state.board, x, y) !== player) continue;
      const dx = Math.abs(x - 6.5);
      const dy = Math.abs(y - 6.5);
      score += 7 - Math.max(dx, dy);
    }
  }

  return score;
}

function largePiecesRemaining(state, player) {
  return state.remainingPieces[player].filter((pieceId) => pieceSize(pieceId) >= 4).length;
}

function endgamePlacableMass(state, player) {
  if (state.status !== "playing") {
    return state.remainingPieces[player].length === 0 ? 0 : -remainingUnitSquares(state, player);
  }

  const scopedState = state.currentPlayer === player ? state : { ...state, currentPlayer: player };
  const legalMoves = generateLegalMoves(scopedState).filter((move) => move.kind === "place");
  if (legalMoves.length === 0) return 0;

  const placeablePieces = new Set(legalMoves.map((move) => move.pieceId));
  let total = 0;
  for (const pieceId of placeablePieces) {
    total += pieceSize(pieceId);
  }
  return total;
}

function totalPlacedCells(state, player) {
  return 89 - remainingUnitSquares(state, player);
}

export function evaluateState(state, player) {
  const opponent = otherPlayer(player);
  const [scoreA, scoreB] = scoreState(state);
  const scores = player === 0 ? [scoreA, scoreB] : [scoreB, scoreA];
  const myPlaced = totalPlacedCells(state, player);
  const oppPlaced = totalPlacedCells(state, opponent);
  const myRemaining = remainingUnitSquares(state, player);
  const oppRemaining = remainingUnitSquares(state, opponent);
  const myCorners = countCornerCandidates(state, player);
  const oppCorners = countCornerCandidates(state, opponent);
  const myLegal = countLegalPlacementsForPlayer(state, player);
  const oppLegal = countLegalPlacementsForPlayer(state, opponent);
  const myCenter = centerAdvanceScoreForPlayer(state, player);
  const oppCenter = centerAdvanceScoreForPlayer(state, opponent);
  const myLargeRemaining = largePiecesRemaining(state, player);
  const oppLargeRemaining = largePiecesRemaining(state, opponent);
  const myPlacableMass = endgamePlacableMass(state, player);
  const oppPlacableMass = endgamePlacableMass(state, opponent);
  const myEdgePenalty = countOccupiedEdgeCells(state, player);
  const oppEdgePenalty = countOccupiedEdgeCells(state, opponent);
  const openingFactor = Math.max(0, 18 - state.turn) / 18;
  const endgameFactor = Math.max(0, 12 - (state.remainingPieces[player].length + state.remainingPieces[opponent].length)) / 12;

  return (
    5.0 * (myPlaced - oppPlaced) +
    1.8 * (scores[0] - scores[1]) +
    0.8 * (oppRemaining - myRemaining) +
    1.35 * (myCorners - oppCorners) +
    0.12 * (myLegal - oppLegal) +
    0.3 * (myCenter - oppCenter) +
    0.35 * (oppCorners - myCorners < 0 ? 1 : 0) +
    1.1 * openingFactor * (oppLargeRemaining - myLargeRemaining) +
    0.45 * endgameFactor * (myPlacableMass - oppPlacableMass) +
    0.12 * (oppEdgePenalty - myEdgePenalty)
  );
}

export function evaluateMoveQuick(state, player, move) {
  if (move.kind === "pass") {
    return -50;
  }

  const opponent = otherPlayer(player);
  const beforeMyCorners = countCornerCandidates(state, player);
  const beforeOppCorners = countCornerCandidates(state, opponent);
  const next = applyMove(state, move);
  const cells = getCellsForMove(move);
  const sizeBonus = cells.length;
  const centerBonus = cells.reduce((sum, cell) => {
    const dx = Math.abs(cell.x - 6.5);
    const dy = Math.abs(cell.y - 6.5);
    return sum + (7 - Math.max(dx, dy));
  }, 0);
  const openingLargePieceBonus = state.turn < 10 ? pieceSize(move.pieceId) : 0;
  const edgeTouches = cells.filter((cell) => (
    cell.x === 0 || cell.y === 0 || cell.x === BOARD_SIZE - 1 || cell.y === BOARD_SIZE - 1
  )).length;
  const afterMyCorners = countCornerCandidates(next, player);
  const afterOppCorners = countCornerCandidates(next, opponent);
  const [scoreA, scoreB] = scoreState(next);
  const myScore = player === 0 ? scoreA : scoreB;
  const oppScore = player === 0 ? scoreB : scoreA;

  return (
    8.0 * sizeBonus +
    1.5 * (afterMyCorners - beforeMyCorners) +
    1.0 * (beforeOppCorners - afterOppCorners) +
    0.22 * centerBonus +
    0.9 * openingLargePieceBonus +
    0.18 * (myScore - oppScore) -
    0.45 * edgeTouches
  );
}

export function createHeuristicScorer(profile = "strong") {
  return (state, player, move) => {
    const base = evaluateMoveQuick(state, player, move);
    if (move.kind === "pass") return base;

    const cells = getCellsForMove(move);
    const size = cells.length;
    const edgeTouches = cells.filter((cell) => (
      cell.x === 0 || cell.y === 0 || cell.x === BOARD_SIZE - 1 || cell.y === BOARD_SIZE - 1
    )).length;

    if (profile === "weak") {
      return 0.45 * base + 1.0 * size - 0.35 * edgeTouches;
    }

    return base + 0.5 * size - 0.2 * edgeTouches;
  };
}
