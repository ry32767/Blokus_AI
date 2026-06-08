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
    policyTargetSource: "visit",
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
    if (value === "--policy-target-source") args.policyTargetSource = argv[++index];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.out), { recursive: true });
  const summary = await generateDataset({
    games: args.games,
    out: args.out,
    teacherMs: args.teacherMs,
    startPolicy: args.startPolicy,
    blackAi: args.difficulty,
    whiteAi: args.difficulty,
    blackModel: args.modelPath,
    whiteModel: args.modelPath,
    policyTargetSource: args.policyTargetSource,
  });
  const workerSummary = {
    workerId: args.workerId,
    generatedAt: new Date().toISOString(),
    games: args.games,
    teacherMs: args.teacherMs,
    difficulty: args.difficulty,
    modelPath: args.modelPath,
    summary,
  };
  await writeFile(`${args.out}.worker.json`, `${JSON.stringify(workerSummary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(workerSummary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
