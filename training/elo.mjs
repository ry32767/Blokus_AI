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

// Sequential Probability Ratio Test (GSPRT / normalized-Gaussian approximation, as
// used by fishtest). Tests H0: elo difference = elo0 vs H1: elo difference = elo1 from
// W/D/L counts, and returns an accept/reject/continue decision plus the log-likelihood
// ratio (LLR). This is far more sample-efficient than a fixed N-game win-rate gate.
export function sprtDecision({
  wins,
  draws,
  losses,
  elo0 = 0,
  elo1 = 10,
  alpha = 0.05,
  beta = 0.05,
}) {
  const n = wins + draws + losses;
  const lower = Math.log(beta / (1 - alpha)); // accept H0 at/below this LLR
  const upper = Math.log((1 - beta) / alpha); // accept H1 at/above this LLR
  if (n === 0) {
    return { llr: 0, lower, upper, decision: "continue", promote: false, games: 0 };
  }
  const s0 = expectedScore(1200 + elo0, 1200);
  const s1 = expectedScore(1200 + elo1, 1200);
  const score = (wins + 0.5 * draws) / n; // mean per-game score
  // per-game score variance: E[x^2] - mean^2, x in {1, 0.5, 0}
  const meanSquare = (wins + 0.25 * draws) / n;
  const variance = Math.max(meanSquare - score * score, 1e-6);
  // Gaussian-approx LLR for n iid games with shared variance (see derivation in tests).
  const llr = (n * (s1 - s0) * (score - (s0 + s1) / 2)) / variance;
  const decision = llr >= upper ? "accept_h1" : llr <= lower ? "accept_h0" : "continue";
  return {
    llr: Number(llr.toFixed(4)),
    lower: Number(lower.toFixed(4)),
    upper: Number(upper.toFixed(4)),
    decision,
    promote: decision === "accept_h1",
    games: n,
    score: Number(score.toFixed(4)),
  };
}

export function sprtGateDecision({
  arena,
  candidateName = "candidate",
  opponentName,
  elo0 = 0,
  elo1 = 10,
  alpha = 0.05,
  beta = 0.05,
}) {
  const score = summarizeArenaScore(arena, candidateName, opponentName);
  const sprt = sprtDecision({
    wins: score.wins,
    draws: score.draws,
    losses: score.losses,
    elo0,
    elo1,
    alpha,
    beta,
  });
  return { score, sprt, promote: sprt.promote, elo0, elo1, alpha, beta };
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
