import { PIECE_SHAPES } from "./pieces.js";

export function pieceSize(pieceId) {
  return PIECE_SHAPES[pieceId].length;
}

export function remainingUnitSquares(state, player) {
  return state.remainingPieces[player].reduce((sum, pieceId) => sum + pieceSize(pieceId), 0);
}

export function scorePlayer(state, player) {
  const remaining = remainingUnitSquares(state, player);
  const completed = state.remainingPieces[player].length === 0;
  const completionBonus = completed ? 15 : 0;
  const monominoLastBonus = completed && state.lastPlacedPiece[player] === "I1" ? 5 : 0;
  return -remaining + completionBonus + monominoLastBonus;
}

export function scoreState(state) {
  return [scorePlayer(state, 0), scorePlayer(state, 1)];
}

export function getWinner(state) {
  const [a, b] = scoreState(state);
  if (a > b) return 0;
  if (b > a) return 1;
  return null;
}
