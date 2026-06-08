import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueSelfPlayJobs, queueStatus } from "./distributed_queue.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    queueDir: join(root, "training", "distributed_queue"),
    outputDir: join(root, "training", "reports", "distributed-queue"),
    workers: 2,
    games: 20,
    teacherMs: 1000,
    difficulty: "master",
    modelPath: null,
    replayBufferDir: join(root, "training", "replay_buffer"),
    startPolicy: "fixedStart",
    policyTargetSource: "visit",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--queue-dir") args.queueDir = argv[++index];
    if (value === "--output-dir") args.outputDir = argv[++index];
    if (value === "--workers") args.workers = Number(argv[++index]);
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--difficulty") args.difficulty = argv[++index];
    if (value === "--model-path") args.modelPath = argv[++index];
    if (value === "--replay-buffer-dir") args.replayBufferDir = argv[++index];
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--policy-target-source") args.policyTargetSource = argv[++index];
  }
  return args;
}

function splitGames(totalGames, workers) {
  const base = Math.floor(totalGames / workers);
  const remainder = totalGames % workers;
  return Array.from({ length: workers }, (_, index) => base + (index < remainder ? 1 : 0))
    .filter((games) => games > 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.outputDir, { recursive: true });
  const splits = splitGames(args.games, args.workers);
  const jobs = splits.map((games, index) => ({
    kind: "selfplay",
    payload: {
      workerLabel: `host-job-${String(index + 1).padStart(3, "0")}`,
      out: join(args.outputDir, `job-${String(index + 1).padStart(3, "0")}.jsonl`),
      games,
      teacherMs: args.teacherMs,
      difficulty: args.difficulty,
      modelPath: args.modelPath,
      replayBufferDir: args.replayBufferDir,
      startPolicy: args.startPolicy,
      policyTargetSource: args.policyTargetSource,
    },
  }));
  const queued = await enqueueSelfPlayJobs(args.queueDir, jobs);
  const status = await queueStatus(args.queueDir);
  const summary = {
    generatedAt: new Date().toISOString(),
    queueDir: args.queueDir,
    queuedJobIds: queued.map((job) => job.id),
    status,
  };
  await writeFile(join(args.outputDir, "coordinator-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
