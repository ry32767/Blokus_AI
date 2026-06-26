import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { addShardToReplayBuffer, pruneReplayBuffer, replayBufferStats } from "./replay_buffer.mjs";
import { normalizeSeed, workerSeedForIndex } from "./seeded_rng.mjs";

const DUPLICATE_WARNING_THRESHOLD = 0.1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    workers: 2,
    games: 20,
    teacherMs: 1000,
    difficulty: "master",
    modelPath: null,
    blackAi: null,
    whiteAi: null,
    blackModel: null,
    whiteModel: null,
    replayBufferDir: join(root, "training", "replay_buffer"),
    workerOutputDir: join(root, "training", "reports", "distributed-selfplay"),
    maxBufferShards: 64,
    maxBufferSamples: 50000,
    startPolicy: "fixedStart",
    policyTargetSource: "visit",
    rootDirichletWeight: 0,
    rootDirichletAlpha: 0.3,
    mctsSamplingTemperature: 0,
    mctsSamplingPlies: 0,
    moveTemperature: 0,
    moveTopK: 8,
    moveSamplingPlies: 16,
    moveCandidatePool: 64,
    shardCompression: "gzip",
    seed: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--workers") args.workers = Math.max(1, Number(argv[++index]));
    if (value === "--games") args.games = Math.max(1, Number(argv[++index]));
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--difficulty") args.difficulty = argv[++index];
    if (value === "--model-path") args.modelPath = argv[++index];
    if (value === "--black-ai") args.blackAi = argv[++index];
    if (value === "--white-ai") args.whiteAi = argv[++index];
    if (value === "--black-model") args.blackModel = argv[++index];
    if (value === "--white-model") args.whiteModel = argv[++index];
    if (value === "--replay-buffer-dir") args.replayBufferDir = argv[++index];
    if (value === "--worker-output-dir") args.workerOutputDir = argv[++index];
    if (value === "--max-buffer-shards") args.maxBufferShards = Number(argv[++index]);
    if (value === "--max-buffer-samples") args.maxBufferSamples = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--policy-target-source") args.policyTargetSource = argv[++index];
    if (value === "--move-temperature") args.moveTemperature = Number(argv[++index]);
    if (value === "--move-top-k") args.moveTopK = Math.max(1, Number(argv[++index]));
    if (value === "--move-sampling-plies") args.moveSamplingPlies = Math.max(0, Number(argv[++index]));
    if (value === "--move-candidate-pool") args.moveCandidatePool = Math.max(1, Number(argv[++index]));
    if (value === "--root-dirichlet-weight") args.rootDirichletWeight = Math.max(0, Number(argv[++index]));
    if (value === "--root-dirichlet-alpha") args.rootDirichletAlpha = Math.max(1e-3, Number(argv[++index]));
    if (value === "--mcts-sampling-temperature") args.mctsSamplingTemperature = Math.max(0, Number(argv[++index]));
    if (value === "--mcts-sampling-plies") args.mctsSamplingPlies = Math.max(0, Number(argv[++index]));
    if (value === "--shard-compression") args.shardCompression = argv[++index];
    if (value === "--seed") args.seed = normalizeSeed(argv[++index]);
  }
  return args;
}

function splitGames(totalGames, workers) {
  const base = Math.floor(totalGames / workers);
  const remainder = totalGames % workers;
  return Array.from({ length: workers }, (_, index) => base + (index < remainder ? 1 : 0))
    .filter((games) => games > 0);
}

async function runWorker(workerSpec) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        join(root, "training", "run_selfplay_worker.mjs"),
        "--worker-id",
        workerSpec.workerId,
        "--out",
        workerSpec.out,
        "--games",
        String(workerSpec.games),
        "--teacher-ms",
        String(workerSpec.teacherMs),
        "--difficulty",
        workerSpec.difficulty,
        "--black-ai",
        workerSpec.blackAi,
        "--white-ai",
        workerSpec.whiteAi,
        "--seed",
        String(workerSpec.seed),
        "--worker-index",
        String(workerSpec.workerIndex),
        "--game-index-offset",
        String(workerSpec.gameIndexOffset),
        "--start-policy",
        workerSpec.startPolicy,
        "--policy-target-source",
        workerSpec.policyTargetSource,
        "--move-temperature",
        String(workerSpec.moveTemperature),
        "--move-top-k",
        String(workerSpec.moveTopK),
        "--move-sampling-plies",
        String(workerSpec.moveSamplingPlies),
        "--move-candidate-pool",
        String(workerSpec.moveCandidatePool),
        "--root-dirichlet-weight",
        String(workerSpec.rootDirichletWeight ?? 0),
        "--root-dirichlet-alpha",
        String(workerSpec.rootDirichletAlpha ?? 0.3),
        "--mcts-sampling-temperature",
        String(workerSpec.mctsSamplingTemperature ?? 0),
        "--mcts-sampling-plies",
        String(workerSpec.mctsSamplingPlies ?? 0),
        ...(workerSpec.modelPath ? ["--model-path", workerSpec.modelPath] : []),
        ...(workerSpec.blackModel ? ["--black-model", workerSpec.blackModel] : []),
        ...(workerSpec.whiteModel ? ["--white-model", workerSpec.whiteModel] : []),
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: false,
      },
    );
    child.on("exit", (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`worker ${workerSpec.workerId} exited with ${code}`));
    });
  });
}

function summarizeDuplicateHashes(gameHashes) {
  const counts = new Map();
  for (const hash of gameHashes) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  const duplicateGames = Array.from(counts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const duplicateHashes = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([hash, count]) => ({ hash, count }))
    .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));
  return {
    totalGames: gameHashes.length,
    uniqueGames: counts.size,
    duplicateGames,
    duplicateHashRate: gameHashes.length === 0 ? 0 : duplicateGames / gameHashes.length,
    duplicateHashes,
  };
}

export async function runDistributedSelfPlay(config = {}) {
  const workers = splitGames(config.games ?? 20, config.workers ?? 2);
  await mkdir(config.workerOutputDir, { recursive: true });
  const difficulty = config.difficulty ?? "master";
  let runningOffset = 0;
  const workerSpecs = workers.map((games, index) => {
    const gameIndexOffset = runningOffset;
    runningOffset += games;
    return {
    workerId: `worker-${String(index + 1).padStart(3, "0")}`,
    workerIndex: index,
    out: join(config.workerOutputDir, `worker-${String(index + 1).padStart(3, "0")}.jsonl`),
    games,
    teacherMs: config.teacherMs ?? 1000,
    difficulty,
    modelPath: config.modelPath ?? null,
    blackAi: config.blackAi ?? difficulty,
    whiteAi: config.whiteAi ?? difficulty,
    seed: workerSeedForIndex(config.seed ?? 0, index),
    gameIndexOffset,
    startPolicy: config.startPolicy ?? "fixedStart",
    policyTargetSource: config.policyTargetSource ?? "visit",
    moveTemperature: Number(config.moveTemperature ?? 0),
    moveTopK: Math.max(1, Number(config.moveTopK ?? 8)),
    moveSamplingPlies: Math.max(0, Number(config.moveSamplingPlies ?? 16)),
    moveCandidatePool: Math.max(1, Number(config.moveCandidatePool ?? 64)),
    rootDirichletWeight: Math.max(0, Number(config.rootDirichletWeight ?? 0)),
    rootDirichletAlpha: Math.max(1e-3, Number(config.rootDirichletAlpha ?? 0.3)),
    mctsSamplingTemperature: Math.max(0, Number(config.mctsSamplingTemperature ?? 0)),
    mctsSamplingPlies: Math.max(0, Number(config.mctsSamplingPlies ?? 0)),
  };
  }).map((workerSpec) => ({
    ...workerSpec,
    blackModel: config.blackModel ?? (workerSpec.blackAi === difficulty ? (config.modelPath ?? null) : null),
    whiteModel: config.whiteModel ?? (workerSpec.whiteAi === difficulty ? (config.modelPath ?? null) : null),
  }));

  await Promise.all(workerSpecs.map(runWorker));
  const workerMetas = await Promise.all(workerSpecs.map(async (workerSpec) => (
    JSON.parse(await readFile(`${workerSpec.out}.meta.json`, "utf-8"))
  )));
  const duplicateSummary = summarizeDuplicateHashes(workerMetas.flatMap((meta) => meta.gameHashes ?? []));
  console.log(
    `[selfplay] distributed duplicateHashRate=${(duplicateSummary.duplicateHashRate * 100).toFixed(2)}% `
      + `duplicateGames=${duplicateSummary.duplicateGames} uniqueGames=${duplicateSummary.uniqueGames}`,
  );
  if (duplicateSummary.duplicateHashRate > DUPLICATE_WARNING_THRESHOLD) {
    console.warn(
      `[warning] distributed self-play duplicate game hash rate `
        + `${(duplicateSummary.duplicateHashRate * 100).toFixed(2)}% `
        + `(${duplicateSummary.duplicateGames}/${duplicateSummary.totalGames})`,
    );
  }
  const imported = [];
  for (const workerSpec of workerSpecs) {
    imported.push(await addShardToReplayBuffer(config.replayBufferDir, workerSpec.out, {
      source: "distributed-selfplay",
      gameCount: workerSpec.games,
      actorPair: [workerSpec.blackAi, workerSpec.whiteAi],
      metadata: {
        workerId: workerSpec.workerId,
        modelPath: workerSpec.modelPath ?? null,
        blackModel: workerSpec.blackModel ?? null,
        whiteModel: workerSpec.whiteModel ?? null,
        teacherMs: workerSpec.teacherMs,
        seed: workerSpec.seed,
        workerIndex: workerSpec.workerIndex,
        gameIndexOffset: workerSpec.gameIndexOffset,
        moveTemperature: workerSpec.moveTemperature,
        moveTopK: workerSpec.moveTopK,
        moveSamplingPlies: workerSpec.moveSamplingPlies,
        moveCandidatePool: workerSpec.moveCandidatePool,
      },
      compression: config.shardCompression ?? "gzip",
    }));
  }

  const pruneSummary = await pruneReplayBuffer(config.replayBufferDir, {
    maxShards: config.maxBufferShards,
    maxSamples: config.maxBufferSamples,
  });
  const stats = await replayBufferStats(config.replayBufferDir);
  const summary = {
    generatedAt: new Date().toISOString(),
    seed: normalizeSeed(config.seed),
    workerSpecs,
    duplicateSummary,
    importedShardIds: imported.map((entry) => entry.id),
    pruneSummary,
    stats,
  };
  await writeFile(join(config.workerOutputDir, "distributed-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  return summary;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const summary = await runDistributedSelfPlay(config);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
