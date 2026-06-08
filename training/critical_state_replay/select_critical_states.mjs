import { phaseForState } from "./branch_dataset_schema.mjs";

function criticalPriority(step, config = {}) {
  const evalDrop = Math.max(0, -(step.deltas?.evaluation ?? 0));
  const mobilityDrop = Math.max(0, -(step.deltas?.myLegalMoves ?? 0));
  const cornerDrop = Math.max(0, -(step.deltas?.myCornerCandidates ?? 0));
  const oppMobilityGain = Math.max(0, step.deltas?.oppLegalMoves ?? 0);
  const phase = phaseForState(step.state);
  const endgameBonus = phase === "endgame" ? 8 : 0;
  const losingBonus = (step.before?.evaluation ?? 0) < -Number(config.losingEvalThreshold ?? 35) ? 5 : 0;

  return evalDrop + 0.45 * mobilityDrop + 2.0 * cornerDrop + 0.2 * oppMobilityGain + endgameBonus + losingBonus;
}

export function isCriticalState(step, config = {}) {
  const evalDropThreshold = Number(config.evalDropThreshold ?? 12);
  const mobilityDropThreshold = Number(config.mobilityDropThreshold ?? 18);
  const cornerDropThreshold = Number(config.cornerDropThreshold ?? 2);
  const priorityThreshold = Number(config.priorityThreshold ?? 8);

  return (
    -(step.deltas?.evaluation ?? 0) >= evalDropThreshold
    || -(step.deltas?.myLegalMoves ?? 0) >= mobilityDropThreshold
    || -(step.deltas?.myCornerCandidates ?? 0) >= cornerDropThreshold
    || criticalPriority(step, config) >= priorityThreshold
    || phaseForState(step.state) === "endgame"
  );
}

export function selectCriticalStates(trajectory, config = {}) {
  const limit = Math.max(1, Number(config.criticalStatesPerGame ?? 8));
  const seen = new Set();
  const candidates = [];

  for (const step of trajectory.steps ?? []) {
    if (!isCriticalState(step, config)) continue;
    if (seen.has(step.state_hash)) continue;
    seen.add(step.state_hash);
    candidates.push({
      ...step,
      game_id: trajectory.game_id,
      score: trajectory.score,
      phase: phaseForState(step.state),
      critical_priority: criticalPriority(step, config),
    });
  }

  candidates.sort((a, b) => b.critical_priority - a.critical_priority);
  return candidates.slice(0, limit);
}
