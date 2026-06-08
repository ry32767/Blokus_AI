import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import {
  CRITICAL_REPLAY_SCHEMA_VERSION,
  phaseForState,
  softmax,
  validateBranchRecord,
} from "./branch_dataset_schema.mjs";
import { selectCriticalStates } from "./select_critical_states.mjs";
import { replayCriticalState } from "./replay_from_state.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export function parseBranchArgs(argv) {
  const args = {
    trajectories: join(root, "training", "dataset", "trajectories", "smoke"),
    out: join(root, "training", "dataset", "critical_replay", "smoke"),
    criticalStatesPerGame: 8,
    topKActions: 8,
    playoutsPerAction: 2,
    teacher: "expert",
    teacherMs: 25,
    temperature: 0.7,
    epsilon: 0.08,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--trajectories") args.trajectories = argv[++index];
    if (value === "--out") args.out = argv[++index];
    if (value === "--critical-states-per-game") args.criticalStatesPerGame = Number(argv[++index]);
    if (value === "--top-k-actions") args.topKActions = Number(argv[++index]);
    if (value === "--playouts-per-action") args.playoutsPerAction = Number(argv[++index]);
    if (value === "--teacher") args.teacher = argv[++index];
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--temperature") args.temperature = Number(argv[++index]);
    if (value === "--epsilon") args.epsilon = Number(argv[++index]);
  }

  return args;
}

function normalizeTrajectoryPath(path) {
  const resolved = resolve(path);
  return resolved.endsWith(".jsonl") ? resolved : join(resolved, "trajectories.jsonl");
}

async function readTrajectories(path) {
  const trajectories = [];
  const input = createReadStream(normalizeTrajectoryPath(path), { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) trajectories.push(JSON.parse(line));
  }
  return trajectories;
}

function buildRecord(criticalState, replayResult, config) {
  const policyProbs = softmax(replayResult.qValues, config.temperature);
  let bestIndex = 0;
  for (let index = 1; index < replayResult.qValues.length; index += 1) {
    if (replayResult.qValues[index] > replayResult.qValues[bestIndex]) bestIndex = index;
  }
  const bestAction = replayResult.evaluatedActions[bestIndex];
  const chosenIndex = replayResult.evaluatedActions.indexOf(criticalState.chosen_action);
  const chosenQ = chosenIndex >= 0 ? replayResult.qValues[chosenIndex] : Math.min(...replayResult.qValues);
  const blunderScore = Math.max(0, replayResult.qValues[bestIndex] - chosenQ);

  const record = {
    schema_version: CRITICAL_REPLAY_SCHEMA_VERSION,
    source: "critical_state_replay",
    state_id: criticalState.state_hash,
    game_id: criticalState.game_id,
    turn: criticalState.turn,
    player: criticalState.player,
    phase: criticalState.phase ?? phaseForState(criticalState.state),
    actor_difficulty: criticalState.actor_difficulty,
    teacher_ai: config.teacher,
    encoded_state: criticalState.encoded_state,
    legal_actions: criticalState.legal_actions,
    evaluated_actions: replayResult.evaluatedActions,
    q_values: replayResult.qValues,
    raw_score_diffs: replayResult.rawScoreDiffs,
    policy_probs: policyProbs,
    chosen_action: criticalState.chosen_action,
    best_action: bestAction,
    selected_action: bestAction,
    expert_selected_action: criticalState.chosen_action,
    policy_target_actions: replayResult.evaluatedActions,
    policy_target_probs: policyProbs,
    value_target: replayResult.qValues[bestIndex],
    final_score_diff: replayResult.rawScoreDiffs[bestIndex] ?? 0,
    blunder_score: blunderScore,
    sampling_priority: 1 + 12 * blunderScore + Math.max(0, criticalState.critical_priority ?? 0) / 10,
    playouts_per_action: replayResult.playoutsPerAction,
    critical_priority: criticalState.critical_priority,
    selection_metrics: {
      before: criticalState.before,
      after: criticalState.after,
      deltas: criticalState.deltas,
    },
  };
  return validateBranchRecord(record);
}

export async function buildBranchDataset(config = {}) {
  const trajectories = await readTrajectories(config.trajectories);
  const outDir = resolve(config.out);
  await mkdir(outDir, { recursive: true });
  const recordsPath = join(outDir, "records.jsonl");
  const stream = createWriteStream(recordsPath, { encoding: "utf-8" });
  let criticalStates = 0;
  let records = 0;

  try {
    for (const trajectory of trajectories) {
      const selected = selectCriticalStates(trajectory, config);
      criticalStates += selected.length;
      for (const criticalState of selected) {
        const replayResult = await replayCriticalState(criticalState, config);
        const record = buildRecord(criticalState, replayResult, config);
        records += 1;
        if (!stream.write(`${JSON.stringify(record)}\n`)) {
          await new Promise((resolveDrain) => stream.once("drain", resolveDrain));
        }
      }
      console.log(`Critical replay ${trajectory.game_id}: ${selected.length} states`);
    }
  } finally {
    await new Promise((resolveEnd, reject) => {
      stream.end((error) => {
        if (error) reject(error);
        else resolveEnd();
      });
    });
  }

  const summary = {
    trajectories: trajectories.length,
    criticalStates,
    records,
    recordsPath,
    topKActions: config.topKActions,
    playoutsPerAction: config.playoutsPerAction,
    teacher: config.teacher,
    teacherMs: config.teacherMs,
  };
  await writeFile(join(outDir, "metadata.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  return summary;
}

async function main() {
  const config = parseBranchArgs(process.argv.slice(2));
  await buildBranchDataset(config);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
