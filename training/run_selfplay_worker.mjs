import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDataset, parseArgs as parseDatasetArgs } from "./generate_dataset.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const datasetDefaults = parseDatasetArgs([]);
  const args = {
    workerId: "worker-001",
    out: join(root, "training", "reports", "workers", "worker-001.jsonl"),
    games: datasetDefaults.games,
    teacherMs: 1000,
    startPolicy: "fixedStart",
    modelPath: null,
    difficulty: "master",
    blackAi: null,
    whiteAi: null,
    blackModel: null,
    whiteModel: null,
    policyTargetSource: "visit",
    moveTemperature: 0,
    moveTopK: 8,
    moveSamplingPlies: 16,
    moveCandidatePool: 64,
    seed: 0,
    workerIndex: 0,
    gameIndexOffset: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--worker-id") args.workerId = argv[++index];
    if (value === "--out") args.out = argv[++index];
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--model-path") args.modelPath = argv[++index];
    if (value === "--difficulty") args.difficulty = argv[++index];
    if (value === "--black-ai") args.blackAi = argv[++index];
    if (value === "--white-ai") args.whiteAi = argv[++index];
    if (value === "--black-model") args.blackModel = argv[++index];
    if (value === "--white-model") args.whiteModel = argv[++index];
    if (value === "--policy-target-source") args.policyTargetSource = argv[++index];
    if (value === "--move-temperature") args.moveTemperature = Number(argv[++index]);
    if (value === "--move-top-k") args.moveTopK = Math.max(1, Number(argv[++index]));
    if (value === "--move-sampling-plies") args.moveSamplingPlies = Math.max(0, Number(argv[++index]));
    if (value === "--move-candidate-pool") args.moveCandidatePool = Math.max(1, Number(argv[++index]));
    if (value === "--seed") args.seed = Number(argv[++index]);
    if (value === "--worker-index") args.workerIndex = Number(argv[++index]);
    if (value === "--game-index-offset") args.gameIndexOffset = Number(argv[++index]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.out), { recursive: true });
  const blackAi = args.blackAi ?? args.difficulty;
  const whiteAi = args.whiteAi ?? args.difficulty;
  const blackModel = args.blackModel ?? (blackAi === args.difficulty ? args.modelPath : null);
  const whiteModel = args.whiteModel ?? (whiteAi === args.difficulty ? args.modelPath : null);
  const summary = await generateDataset({
    games: args.games,
    out: args.out,
    teacherMs: args.teacherMs,
    startPolicy: args.startPolicy,
    blackAi,
    whiteAi,
    blackModel,
    whiteModel,
    policyTargetSource: args.policyTargetSource,
    moveTemperature: args.moveTemperature,
    moveTopK: args.moveTopK,
    moveSamplingPlies: args.moveSamplingPlies,
    moveCandidatePool: args.moveCandidatePool,
    seed: args.seed,
    workerId: args.workerId,
    workerIndex: args.workerIndex,
    gameIndexOffset: args.gameIndexOffset,
  });
  const workerSummary = {
    workerId: args.workerId,
    generatedAt: new Date().toISOString(),
    games: args.games,
    teacherMs: args.teacherMs,
    difficulty: args.difficulty,
    modelPath: args.modelPath,
    blackAi,
    whiteAi,
    blackModel,
    whiteModel,
    moveTemperature: args.moveTemperature,
    moveTopK: args.moveTopK,
    moveSamplingPlies: args.moveSamplingPlies,
    moveCandidatePool: args.moveCandidatePool,
    seed: args.seed,
    workerIndex: args.workerIndex,
    gameIndexOffset: args.gameIndexOffset,
    summary,
  };
  await writeFile(`${args.out}.worker.json`, `${JSON.stringify(workerSummary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(workerSummary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
