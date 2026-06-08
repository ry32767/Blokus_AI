import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addShardToReplayBuffer } from "./replay_buffer.mjs";
import { claimNextJob, completeJob, failJob, queueStatus } from "./distributed_queue.mjs";
import { generateDataset } from "./generate_dataset.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    queueDir: join(root, "training", "distributed_queue"),
    hostId: `host-${process.pid}`,
    maxJobs: 1,
    idleMs: 200,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--queue-dir") args.queueDir = argv[++index];
    if (value === "--host-id") args.hostId = argv[++index];
    if (value === "--max-jobs") args.maxJobs = Number(argv[++index]);
    if (value === "--idle-ms") args.idleMs = Number(argv[++index]);
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processJob(queueDir, job) {
  const payload = job.payload ?? {};
  await mkdir(dirname(payload.out), { recursive: true });
  const summary = await generateDataset({
    games: payload.games ?? 1,
    out: payload.out,
    teacherMs: payload.teacherMs ?? 1000,
    startPolicy: payload.startPolicy ?? "fixedStart",
    blackAi: payload.difficulty ?? "master",
    whiteAi: payload.difficulty ?? "master",
    blackModel: payload.modelPath ?? null,
    whiteModel: payload.modelPath ?? null,
    policyTargetSource: payload.policyTargetSource ?? "visit",
  });
  const shard = await addShardToReplayBuffer(payload.replayBufferDir, payload.out, {
    source: "multi-host-selfplay",
    gameCount: payload.games ?? 1,
    actorPair: [payload.difficulty ?? "master", payload.difficulty ?? "master"],
    compression: "gzip",
    metadata: {
      hostId: job.claimedBy ?? null,
      workerLabel: payload.workerLabel ?? null,
    },
  });
  return { summary, shard };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const processed = [];
  while (processed.length < args.maxJobs) {
    const job = await claimNextJob(args.queueDir, args.hostId);
    if (!job) {
      const status = await queueStatus(args.queueDir);
      if ((status.counts.pending ?? 0) === 0) break;
      await sleep(args.idleMs);
      continue;
    }
    try {
      const output = await processJob(args.queueDir, job);
      await completeJob(args.queueDir, job.id, output);
      processed.push({ jobId: job.id, status: "done", output });
    } catch (error) {
      await failJob(args.queueDir, job.id, {
        message: error instanceof Error ? error.message : String(error),
      });
      processed.push({ jobId: job.id, status: "failed" });
    }
  }
  console.log(JSON.stringify({
    hostId: args.hostId,
    processed,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
