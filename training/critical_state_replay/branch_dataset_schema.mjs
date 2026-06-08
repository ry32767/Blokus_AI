import { STATE_PLANES } from "../../packages/core/src/index.js";

export const CRITICAL_REPLAY_SCHEMA_VERSION = 1;
export const MAX_SCORE_DIFF = 89;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function normalizeScoreDiff(scoreDiff) {
  return clamp(scoreDiff / MAX_SCORE_DIFF, -1, 1);
}

export function softmax(values, temperature = 0.7) {
  if (values.length === 0) return [];
  const safeTemperature = Math.max(0.01, Number(temperature) || 0.7);
  const maxValue = Math.max(...values);
  const exps = values.map((value) => Math.exp((value - maxValue) / safeTemperature));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / Math.max(1e-12, total));
}

export function phaseForState(state) {
  const remainingCount = state.remainingPieces[0].length + state.remainingPieces[1].length;
  if (state.turn < 10) return "opening";
  if (remainingCount <= 10 || state.turn >= 42) return "endgame";
  return "midgame";
}

export function validateBranchRecord(record) {
  if (record.schema_version !== CRITICAL_REPLAY_SCHEMA_VERSION) {
    throw new Error(`Unsupported critical replay schema version: ${record.schema_version}`);
  }
  if (record.source !== "critical_state_replay") {
    throw new Error("Critical replay record must use source=critical_state_replay.");
  }
  if (!Array.isArray(record.encoded_state) || record.encoded_state.length !== STATE_PLANES * 14 * 14) {
    throw new Error("Critical replay record has an invalid encoded_state.");
  }
  if (!Array.isArray(record.legal_actions) || record.legal_actions.length === 0) {
    throw new Error("Critical replay record must include legal_actions.");
  }
  if (!Array.isArray(record.evaluated_actions) || record.evaluated_actions.length === 0) {
    throw new Error("Critical replay record must include evaluated_actions.");
  }
  if (!Array.isArray(record.q_values) || record.q_values.length !== record.evaluated_actions.length) {
    throw new Error("Critical replay record must include q_values for each evaluated action.");
  }
  if (!Array.isArray(record.policy_probs) || record.policy_probs.length !== record.evaluated_actions.length) {
    throw new Error("Critical replay record must include policy_probs for each evaluated action.");
  }
  const probSum = record.policy_probs.reduce((sum, value) => sum + Number(value), 0);
  if (!Number.isFinite(probSum) || Math.abs(probSum - 1) > 1e-4) {
    throw new Error(`Critical replay policy_probs must sum to 1, got ${probSum}.`);
  }
  if (!record.legal_actions.includes(record.best_action)) {
    throw new Error("Critical replay best_action must be legal.");
  }
  return record;
}
