function clampProbability(value) {
  return Math.min(0.999, Math.max(0.001, value));
}

export function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

export function updateEloRatings(ratingA, ratingB, scoreA, kFactor = 24) {
  const expectedA = expectedScore(ratingA, ratingB);
  const delta = kFactor * (scoreA - expectedA);
  return {
    ratingA: Number((ratingA + delta).toFixed(3)),
    ratingB: Number((ratingB - delta).toFixed(3)),
    delta: Number(delta.toFixed(3)),
    expectedA: Number(expectedA.toFixed(6)),
  };
}

export function summarizeArenaScore(arena, candidateName, opponentName) {
  const candidate = arena.contestants[candidateName];
  const opponent = arena.contestants[opponentName];
  const totalGames = Math.max(1, arena.totalGames ?? (
    candidate.wins + candidate.losses + candidate.draws
  ));
  const scoreRate = (candidate.wins + 0.5 * candidate.draws) / totalGames;
  return {
    totalGames,
    scoreRate,
    wins: candidate.wins,
    losses: candidate.losses,
    draws: candidate.draws,
    averageMargin: candidate.averageMargin,
    opponentAverageMargin: opponent?.averageMargin ?? null,
  };
}

export function estimateEloFromScoreRate(scoreRate) {
  const p = clampProbability(scoreRate);
  return Number((400 * Math.log10(p / (1 - p))).toFixed(3));
}

export function estimateEloConfidence(scoreRate, totalGames, zScore = 1.96) {
  const p = clampProbability(scoreRate);
  const standardError = Math.sqrt((p * (1 - p)) / Math.max(1, totalGames));
  const lower = clampProbability(p - zScore * standardError);
  const upper = clampProbability(p + zScore * standardError);
  return {
    lowerProbability: Number(lower.toFixed(6)),
    upperProbability: Number(upper.toFixed(6)),
    lowerElo: estimateEloFromScoreRate(lower),
    upperElo: estimateEloFromScoreRate(upper),
  };
}

export function eloGateDecision({
  arena,
  candidateName = "candidate",
  opponentName,
  candidateRating = 1200,
  opponentRating = 1200,
  kFactor = 24,
  minLowerBoundGain = 0,
}) {
  const score = summarizeArenaScore(arena, candidateName, opponentName);
  const confidence = estimateEloConfidence(score.scoreRate, score.totalGames);
  const ratingUpdate = updateEloRatings(candidateRating, opponentRating, score.scoreRate, kFactor);
  const estimatedGain = estimateEloFromScoreRate(score.scoreRate);
  const promote = confidence.lowerElo >= minLowerBoundGain;
  return {
    score,
    confidence,
    ratingUpdate,
    estimatedGain,
    promote,
    minLowerBoundGain,
  };
}
