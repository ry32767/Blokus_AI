export function resolveRng(config = {}) {
  return typeof config.rng === "function" ? config.rng : Math.random;
}

export function scoredDescending(items, getScore, rng = Math.random) {
  return items
    .map((item) => ({
      item,
      score: getScore(item),
      tie: rng(),
    }))
    .sort((a, b) => (b.score - a.score) || (a.tie - b.tie));
}

export function chooseBestByScore(items, getScore, rng = Math.random) {
  let bestItem = items[0];
  let bestScore = getScore(bestItem);
  let ties = 1;
  for (const item of items.slice(1)) {
    const score = getScore(item);
    if (score > bestScore) {
      bestItem = item;
      bestScore = score;
      ties = 1;
      continue;
    }
    if (score === bestScore) {
      ties += 1;
      if (rng() < 1 / ties) {
        bestItem = item;
      }
    }
  }
  return { item: bestItem, score: bestScore };
}
