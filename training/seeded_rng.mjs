export const WORKER_SEED_STRIDE = 1000003;

export function normalizeSeed(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback >>> 0;
  return Math.trunc(numeric) >>> 0;
}

export function createSeededRng(seed) {
  let state = normalizeSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function workerSeedForIndex(baseSeed, workerIndex) {
  return normalizeSeed(baseSeed + workerIndex * WORKER_SEED_STRIDE);
}

export function gameSeedForIndex(workerSeed, localGameIndex) {
  return normalizeSeed(workerSeed + localGameIndex);
}
