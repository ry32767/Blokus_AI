import { generateLegalMoves } from "../../../../packages/core/src/index.js";

export class TranspositionTable {
  constructor() {
    this.entries = new Map();
  }

  get(hash) {
    return this.entries.get(hash) ?? null;
  }

  set(entry) {
    this.entries.set(entry.hash, entry);
    return entry;
  }

  clear() {
    this.entries.clear();
  }
}

export function hashState(state) {
  const board = state.board.join(",");
  const starts = state.startAssignment.join(",");
  const remaining = state.remainingPieces.map((pieces) => pieces.join(".")).join("|");
  const placed = state.placedPieces.map((pieces) => pieces.join(".")).join("|");
  const lastPlaced = state.lastPlacedPiece.join(",");
  const forced = state.forcedPassed.join(",");
  return [
    state.currentPlayer,
    state.turn,
    state.status,
    state.startPolicy,
    starts,
    lastPlaced,
    forced,
    state.consecutivePasses,
    remaining,
    placed,
    board,
  ].join("#");
}

export function totalRemainingPieces(state) {
  return state.remainingPieces[0].length + state.remainingPieces[1].length;
}

export function totalLegalPlacements(state) {
  const ownMoves = generateLegalMoves(state).filter((move) => move.kind === "place").length;
  const opponentState = { ...state, currentPlayer: state.currentPlayer === 0 ? 1 : 0 };
  const oppMoves = generateLegalMoves(opponentState).filter((move) => move.kind === "place").length;
  return ownMoves + oppMoves;
}
