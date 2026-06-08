import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove,
  createInitialState,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
  scoreState,
} from "../packages/core/src/index.js";
import { decideTrainingMove, normalizeTrainingAiSpec } from "./ai_runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseArgs(argv) {
  const args = {
    games: 100,
    out: join(root, "training", "data", "smoke-expert-100.jsonl"),
    teacherMs: 25,
    startPolicy: "fixedStart",
    blackAi: "expert",
    whiteAi: "expert",
    blackModel: null,
    whiteModel: null,
    policyTargetSource: "auto",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--out") args.out = argv[++index];
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--black-ai") args.blackAi = argv[++index];
    if (value === "--white-ai") args.whiteAi = argv[++index];
    if (value === "--black-model") args.blackModel = argv[++index];
    if (value === "--white-model") args.whiteModel = argv[++index];
    if (value === "--policy-target-source") args.policyTargetSource = argv[++index];
  }

  return args;
}

export async function playTrainingGame(config) {
  const black = normalizeTrainingAiSpec({
    difficulty: config.blackAi ?? "expert",
    modelPath: config.blackModel,
    timeLimitMs: config.teacherMs,
    label: "black",
  });
  const white = normalizeTrainingAiSpec({
    difficulty: config.whiteAi ?? "expert",
    modelPath: config.whiteModel,
    timeLimitMs: config.teacherMs,
    label: "white",
  });
  let state = createInitialState(config.startPolicy);
  const samples = [];
  const includeVisitTargets = config.policyTargetSource === "visit" || config.policyTargetSource === "auto";

  while (state.status === "playing") {
    const currentPlayer = state.currentPlayer;
    const legalMoves = generateLegalMoves(state);
    const decision = await decideTrainingMove(state, currentPlayer === 0 ? black : white);
    const legalActions = legalMoves.map(encodeAction);
    const stats = decision.stats ?? {};
    const useVisitTargets = includeVisitTargets
      && Array.isArray(stats.policyTargetActions)
      && Array.isArray(stats.policyTargetProbs)
      && stats.policyTargetActions.length > 0
      && stats.policyTargetActions.length === stats.policyTargetProbs.length;
    samples.push({
      player: currentPlayer,
      actor_difficulty: currentPlayer === 0 ? black.difficulty : white.difficulty,
      encoded_state: Array.from(encodeStateTensor(state, currentPlayer)),
      legal_actions: legalActions,
      selected_action: encodeAction(decision.move),
      expert_selected_action: encodeAction(decision.move),
      final_score_diff: 0,
      policy_target_actions: useVisitTargets ? stats.policyTargetActions : [encodeAction(decision.move)],
      policy_target_probs: useVisitTargets ? stats.policyTargetProbs : [1],
      policy_target_visits: useVisitTargets ? (stats.policyTargetVisits ?? null) : [1],
      policy_target_total_visits: useVisitTargets ? (stats.policyTargetTotalVisits ?? null) : 1,
      root_value: typeof stats.rootValue === "number" ? stats.rootValue : null,
      strategy: stats.strategy ?? null,
    });
    state = applyMove(state, decision.move);
  }

  const [blackScore, whiteScore] = scoreState(state);
  for (const sample of samples) {
    sample.final_score_diff = sample.player === 0
      ? blackScore - whiteScore
      : whiteScore - blackScore;
  }

  return { state, samples, score: [blackScore, whiteScore] };
}

export async function generateDataset(config) {
  let totalPositions = 0;
  await mkdir(dirname(config.out), { recursive: true });
  const stream = createWriteStream(config.out, { encoding: "utf-8" });

  try {
    for (let gameIndex = 0; gameIndex < config.games; gameIndex += 1) {
      const { samples, score } = await playTrainingGame(config);
      totalPositions += samples.length;

      for (const sample of samples) {
        if (!stream.write(`${JSON.stringify(sample)}\n`)) {
          await new Promise((resolve) => stream.once("drain", resolve));
        }
      }

      console.log(`Generated game ${gameIndex + 1}/${config.games} (${samples.length} positions, score ${score[0]}-${score[1]})`);
    }
  } finally {
    await new Promise((resolve, reject) => {
      stream.end((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  await writeFile(
    `${config.out}.meta.json`,
    `${JSON.stringify({
      games: config.games,
      totalPositions,
      blackAi: config.blackAi ?? "expert",
      whiteAi: config.whiteAi ?? "expert",
      blackModel: config.blackModel ?? null,
      whiteModel: config.whiteModel ?? null,
      policyTargetSource: config.policyTargetSource ?? "auto",
      teacherMs: config.teacherMs,
      startPolicy: config.startPolicy,
    }, null, 2)}\n`,
  );

  console.log(`Saved ${totalPositions} samples to ${config.out}`);
  return {
    games: config.games,
    totalPositions,
    out: config.out,
    metaPath: `${config.out}.meta.json`,
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  await generateDataset(config);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
