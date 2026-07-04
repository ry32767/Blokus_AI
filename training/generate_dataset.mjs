import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  applyMove,
  createInitialState,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
  scoreState,
} from "../packages/core/src/index.js";
import { evaluateMoveQuick } from "../apps/web/src/ai/evaluation.js";
import { decideTrainingMove, normalizeTrainingAiSpec } from "./ai_runtime.mjs";
import { createSeededRng, gameSeedForIndex, normalizeSeed, workerSeedForIndex } from "./seeded_rng.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const DUPLICATE_WARNING_THRESHOLD = 0.1;

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
    moveTemperature: 0,
    moveTopK: 8,
    moveSamplingPlies: 16,
    moveCandidatePool: 64,
    // AlphaZero-style exploration applied INSIDE the MCTS actor (master). Unlike the
    // heuristic moveTemperature resampler above, these keep the MCTS visit-count policy
    // target valid because the played move is always part of the search.
    rootDirichletWeight: 0,
    rootDirichletAlpha: 0.3,
    mctsSamplingTemperature: 0,
    mctsSamplingPlies: 0,
    seed: 0,
    workerId: "worker-001",
    workerIndex: 0,
    gameIndexOffset: 0,
    parallel: 1,
    checkpointPercent: 0,
    workerMode: false,
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
    if (value === "--move-temperature") args.moveTemperature = Number(argv[++index]);
    if (value === "--move-top-k") args.moveTopK = Math.max(1, Number(argv[++index]));
    if (value === "--move-sampling-plies") args.moveSamplingPlies = Math.max(0, Number(argv[++index]));
    if (value === "--move-candidate-pool") args.moveCandidatePool = Math.max(1, Number(argv[++index]));
    if (value === "--root-dirichlet-weight") args.rootDirichletWeight = Math.max(0, Number(argv[++index]));
    if (value === "--root-dirichlet-alpha") args.rootDirichletAlpha = Math.max(1e-3, Number(argv[++index]));
    if (value === "--mcts-sampling-temperature") args.mctsSamplingTemperature = Math.max(0, Number(argv[++index]));
    if (value === "--mcts-sampling-plies") args.mctsSamplingPlies = Math.max(0, Number(argv[++index]));
    if (value === "--seed") args.seed = normalizeSeed(argv[++index]);
    if (value === "--worker-id") args.workerId = argv[++index];
    if (value === "--worker-index") args.workerIndex = Number(argv[++index]);
    if (value === "--game-index-offset") args.gameIndexOffset = Number(argv[++index]);
    if (value === "--parallel") args.parallel = Math.max(1, Number(argv[++index]));
    if (value === "--checkpoint-percent") args.checkpointPercent = Math.max(0, Number(argv[++index]));
    if (value === "--worker-mode") args.workerMode = true;
  }

  return args;
}

function shouldSampleMove(config, state) {
  const temperature = Number(config.moveTemperature ?? 0);
  if (!Number.isFinite(temperature) || temperature <= 0) return false;
  const plies = Number(config.moveSamplingPlies ?? 16);
  return plies <= 0 || state.turn < plies;
}

function sampleCandidateMove(state, legalMoves, teacherMove, config, rng) {
  if (!shouldSampleMove(config, state) || legalMoves.length <= 1) {
    return { move: teacherMove, sampled: false, candidates: 1 };
  }

  const teacherAction = encodeAction(teacherMove);
  const seen = new Set([teacherAction]);
  const teacherEntry = {
    move: teacherMove,
    action: teacherAction,
    score: Number.POSITIVE_INFINITY,
    rank: 0,
  };
  const candidatePool = legalMoves
    .map((move) => ({ move, action: encodeAction(move) }))
    .filter((entry) => entry.action !== teacherAction);
  const poolLimit = Math.max(1, Number(config.moveCandidatePool ?? 64));
  for (let index = 0; index < Math.min(poolLimit, candidatePool.length); index += 1) {
    const swapIndex = index + Math.floor(rng() * (candidatePool.length - index));
    [candidatePool[index], candidatePool[swapIndex]] = [candidatePool[swapIndex], candidatePool[index]];
  }
  const scored = candidatePool
    .slice(0, poolLimit)
    .map((entry) => ({
      ...entry,
      score: evaluateMoveQuick(state, state.currentPlayer, entry.move),
    }))
    .sort((a, b) => b.score - a.score || a.action - b.action);

  const candidates = [teacherEntry];
  for (const entry of scored) {
    if (seen.has(entry.action)) continue;
    seen.add(entry.action);
    candidates.push({ ...entry, rank: candidates.length });
    if (candidates.length >= Math.max(1, Number(config.moveTopK ?? 8))) break;
  }

  const temperature = Math.max(0.01, Number(config.moveTemperature));
  const weights = candidates.map((entry) => Math.exp(-entry.rank / temperature));
  const total = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = rng() * total;
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return {
        move: candidates[index].move,
        sampled: candidates[index].action !== teacherAction,
        candidates: candidates.length,
        teacherAction,
        selectedAction: candidates[index].action,
      };
    }
  }
  const fallback = candidates.at(-1);
  return {
    move: fallback.move,
    sampled: fallback.action !== teacherAction,
    candidates: candidates.length,
    teacherAction,
    selectedAction: fallback.action,
  };
}

export async function playTrainingGame(config) {
  const rng = config.rng ?? Math.random;
  // Exploration knobs read by the MCTS actor (apps/web/src/ai/policyValueMctsAi.js).
  // They are inert for non-MCTS actors and keep the visit-count policy target valid.
  const explorationSpec = {
    rootDirichletWeight: config.rootDirichletWeight ?? 0,
    rootDirichletAlpha: config.rootDirichletAlpha ?? 0.3,
    moveSamplingTemperature: config.mctsSamplingTemperature ?? 0,
    moveSamplingPlies: config.mctsSamplingPlies ?? 0,
  };
  const black = normalizeTrainingAiSpec({
    difficulty: config.blackAi ?? "expert",
    modelPath: config.blackModel,
    timeLimitMs: config.teacherMs,
    label: "black",
    rng,
    ...explorationSpec,
  });
  const white = normalizeTrainingAiSpec({
    difficulty: config.whiteAi ?? "expert",
    modelPath: config.whiteModel,
    timeLimitMs: config.teacherMs,
    label: "white",
    rng,
    ...explorationSpec,
  });
  let state = createInitialState(config.startPolicy);
  const samples = [];
  // Default matches the CLI ("auto"): programmatic callers that omit
  // policyTargetSource must not silently degrade MCTS visit distributions
  // to one-hot targets.
  const policyTargetSource = config.policyTargetSource ?? "auto";
  const includeVisitTargets = policyTargetSource === "visit" || policyTargetSource === "auto";

  while (state.status === "playing") {
    const currentPlayer = state.currentPlayer;
    const legalMoves = generateLegalMoves(state);
    const decision = await decideTrainingMove(state, currentPlayer === 0 ? black : white);
    const sampledDecision = sampleCandidateMove(state, legalMoves, decision.move, config, rng);
    const selectedMove = sampledDecision.move;
    const legalActions = legalMoves.map(encodeAction);
    const stats = decision.stats ?? {};
    // The policy target must always reflect the teacher's search output, even
    // when temperature resampling picks a different move to PLAY: training the
    // policy net toward the exploration move would teach it the noise itself.
    const useVisitTargets = includeVisitTargets
      && Array.isArray(stats.policyTargetActions)
      && Array.isArray(stats.policyTargetProbs)
      && stats.policyTargetActions.length > 0
      && stats.policyTargetActions.length === stats.policyTargetProbs.length;
    const selectedAction = encodeAction(selectedMove);
    const teacherAction = encodeAction(decision.move);
    samples.push({
      player: currentPlayer,
      actor_difficulty: currentPlayer === 0 ? black.difficulty : white.difficulty,
      encoded_state: Array.from(encodeStateTensor(state, currentPlayer)),
      legal_actions: legalActions,
      selected_action: selectedAction,
      expert_selected_action: teacherAction,
      final_score_diff: 0,
      policy_target_actions: useVisitTargets ? stats.policyTargetActions : [teacherAction],
      policy_target_probs: useVisitTargets ? stats.policyTargetProbs : [1],
      policy_target_visits: useVisitTargets ? (stats.policyTargetVisits ?? null) : [1],
      policy_target_total_visits: useVisitTargets ? (stats.policyTargetTotalVisits ?? null) : 1,
      root_value: typeof stats.rootValue === "number" ? stats.rootValue : null,
      strategy: sampledDecision.sampled ? "temperature_sampled" : (stats.strategy ?? null),
      teacher_strategy: stats.strategy ?? null,
      sampled_from_teacher: sampledDecision.sampled,
      sampling_candidates: sampledDecision.candidates,
    });
    state = applyMove(state, selectedMove);
  }

  const [blackScore, whiteScore] = scoreState(state);
  for (const sample of samples) {
    sample.final_score_diff = sample.player === 0
      ? blackScore - whiteScore
      : whiteScore - blackScore;
  }

  return { state, samples, score: [blackScore, whiteScore] };
}

function hashGame(state, score) {
  return createHash("sha1")
    .update(JSON.stringify({
      startPolicy: state.startPolicy,
      startAssignment: state.startAssignment,
      moves: state.moveHistory.map((record) => record.move),
      score,
    }))
    .digest("hex");
}

function summarizeDuplicateHashes(gameHashes) {
  const counts = new Map();
  for (const hash of gameHashes) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  const duplicates = Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([hash, count]) => ({ hash, count }))
    .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));
  const duplicateGames = duplicates.reduce((sum, entry) => sum + (entry.count - 1), 0);
  return {
    totalGames: gameHashes.length,
    uniqueGames: counts.size,
    duplicateGames,
    duplicateHashRate: gameHashes.length === 0 ? 0 : duplicateGames / gameHashes.length,
    duplicateHashes: duplicates,
  };
}

function logDuplicateWarning(summary, label) {
  if (summary.duplicateHashRate > DUPLICATE_WARNING_THRESHOLD) {
    console.warn(
      `[warning] ${label} duplicate game hash rate ${(summary.duplicateHashRate * 100).toFixed(2)}% `
        + `(${summary.duplicateGames}/${summary.totalGames})`,
    );
  }
}

export async function generateDataset(config) {
  let totalPositions = 0;
  const gameHashes = [];
  const workerSeed = normalizeSeed(config.seed);
  await mkdir(dirname(config.out), { recursive: true });
  const stream = createWriteStream(config.out, { encoding: "utf-8" });

  try {
    for (let gameIndex = 0; gameIndex < config.games; gameIndex += 1) {
      const localGameIndex = gameIndex;
      const globalGameIndex = (config.gameIndexOffset ?? 0) + localGameIndex;
      const gameSeed = gameSeedForIndex(workerSeed, localGameIndex);
      const { state, samples, score } = await playTrainingGame({
        ...config,
        rng: createSeededRng(gameSeed),
      });
      const gameHash = hashGame(state, score);
      gameHashes.push(gameHash);
      totalPositions += samples.length;

      for (const sample of samples) {
        if (!stream.write(`${JSON.stringify(sample)}\n`)) {
          await new Promise((resolve) => stream.once("drain", resolve));
        }
      }

      console.log(
        `[selfplay] workerId=${config.workerId ?? "worker-001"} `
          + `gameIndex=${globalGameIndex} localGameIndex=${localGameIndex} `
          + `seed=${gameSeed} gameHash=${gameHash.slice(0, 16)} `
          + `score=${score[0]}-${score[1]} positions=${samples.length}`,
      );
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
      moveTemperature: Number(config.moveTemperature ?? 0),
      moveTopK: Number(config.moveTopK ?? 8),
      moveSamplingPlies: Number(config.moveSamplingPlies ?? 16),
      moveCandidatePool: Number(config.moveCandidatePool ?? 64),
      teacherMs: config.teacherMs,
      startPolicy: config.startPolicy,
      seed: workerSeed,
      workerId: config.workerId ?? "worker-001",
      workerIndex: config.workerIndex ?? 0,
      gameIndexOffset: config.gameIndexOffset ?? 0,
      gameHashes,
      duplicateSummary: summarizeDuplicateHashes(gameHashes),
    }, null, 2)}\n`,
  );

  const duplicateSummary = summarizeDuplicateHashes(gameHashes);
  console.log(
    `[selfplay] workerId=${config.workerId ?? "worker-001"} duplicateHashRate=`
      + `${(duplicateSummary.duplicateHashRate * 100).toFixed(2)}% `
      + `duplicateGames=${duplicateSummary.duplicateGames} uniqueGames=${duplicateSummary.uniqueGames}`,
  );
  logDuplicateWarning(duplicateSummary, `worker ${config.workerId ?? "worker-001"}`);

  console.log(`Saved ${totalPositions} samples to ${config.out}`);
  return {
    games: config.games,
    totalPositions,
    out: config.out,
    metaPath: `${config.out}.meta.json`,
    seed: workerSeed,
    gameHashes,
    duplicateSummary,
  };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.parallel > 1 && !config.workerMode) {
    await generateDatasetParallel(config);
  } else {
    await generateDataset(config);
  }
}

function splitGames(totalGames, workers) {
  const actualWorkers = Math.max(1, Math.min(workers, totalGames));
  const base = Math.floor(totalGames / actualWorkers);
  const remainder = totalGames % actualWorkers;
  return Array.from({ length: actualWorkers }, (_, index) => base + (index < remainder ? 1 : 0))
    .filter((games) => games > 0);
}

function runDatasetWorker(config, games, out, workerIndex, gameIndexOffset, seedWorkerIndex = workerIndex) {
  const workerSeed = workerSeedForIndex(config.seed ?? 0, seedWorkerIndex);
  const args = [
    fileURLToPath(import.meta.url),
    "--games", String(games),
    "--out", out,
    "--teacher-ms", String(config.teacherMs),
    "--start-policy", config.startPolicy,
    "--black-ai", config.blackAi,
    "--white-ai", config.whiteAi,
    "--policy-target-source", config.policyTargetSource,
    "--move-temperature", String(config.moveTemperature ?? 0),
    "--move-top-k", String(config.moveTopK ?? 8),
    "--move-sampling-plies", String(config.moveSamplingPlies ?? 16),
    "--move-candidate-pool", String(config.moveCandidatePool ?? 64),
    "--root-dirichlet-weight", String(config.rootDirichletWeight ?? 0),
    "--root-dirichlet-alpha", String(config.rootDirichletAlpha ?? 0.3),
    "--mcts-sampling-temperature", String(config.mctsSamplingTemperature ?? 0),
    "--mcts-sampling-plies", String(config.mctsSamplingPlies ?? 0),
    "--seed", String(workerSeed),
    "--worker-id", `worker-${String(seedWorkerIndex + 1).padStart(3, "0")}`,
    "--worker-index", String(seedWorkerIndex),
    "--game-index-offset", String(gameIndexOffset),
    "--worker-mode",
    ...(config.blackModel ? ["--black-model", config.blackModel] : []),
    ...(config.whiteModel ? ["--white-model", config.whiteModel] : []),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn("node", args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        BLOKUS_ORT_THREADS: process.env.BLOKUS_ORT_THREADS ?? "1",
      },
    });
    child.on("exit", (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`dataset worker exited with ${code}`));
    });
  });
}

async function appendFileToStream(path, stream) {
  await pipeline(createReadStream(path, { encoding: "utf-8" }), stream, { end: false });
}

function splitCheckpointStages(totalGames, checkpointPercent) {
  const percent = Number(checkpointPercent ?? 0);
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) return [totalGames];
  const stageSize = Math.max(1, Math.floor(totalGames * (percent / 100)));
  const stages = [];
  let remaining = totalGames;
  while (remaining > 0) {
    const games = Math.min(stageSize, remaining);
    stages.push(games);
    remaining -= games;
  }
  return stages;
}

async function writeJsonAtomic(path, value) {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tempPath, path);
}

function buildParallelMeta(config, completedGames, totalPositions, gameHashes, checkpoint) {
  return {
    games: config.games,
    completedGames,
    totalPositions,
    blackAi: config.blackAi ?? "expert",
    whiteAi: config.whiteAi ?? "expert",
    blackModel: config.blackModel ?? null,
    whiteModel: config.whiteModel ?? null,
    policyTargetSource: config.policyTargetSource ?? "auto",
    moveTemperature: Number(config.moveTemperature ?? 0),
    moveTopK: Number(config.moveTopK ?? 8),
    moveSamplingPlies: Number(config.moveSamplingPlies ?? 16),
    moveCandidatePool: Number(config.moveCandidatePool ?? 64),
    teacherMs: config.teacherMs,
    startPolicy: config.startPolicy,
    parallel: config.parallel,
    seed: normalizeSeed(config.seed),
    checkpoint,
    gameHashes,
    duplicateSummary: summarizeDuplicateHashes(gameHashes),
  };
}

export async function generateDatasetParallel(config) {
  const tempDir = await mkdtemp(join(tmpdir(), "blokus-dataset-"));
  const stages = splitCheckpointStages(config.games, config.checkpointPercent);
  await mkdir(dirname(config.out), { recursive: true });

  try {
    await writeFile(config.out, "", "utf-8");
    let totalPositions = 0;
    const gameHashes = [];
    let completedGames = 0;
    let seedWorkerOffset = 0;

    for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
      const stageGames = stages[stageIndex];
      const chunks = splitGames(stageGames, config.parallel);
      const stageDir = join(tempDir, `stage-${String(stageIndex + 1).padStart(3, "0")}`);
      await mkdir(stageDir, { recursive: true });
      const shardPaths = chunks.map((_, index) => join(stageDir, `dataset-${String(index + 1).padStart(3, "0")}.jsonl`));
      let runningOffset = completedGames;
      const workerPlans = chunks.map((games, index) => {
        const plan = {
          games,
          index,
          seedWorkerIndex: seedWorkerOffset + index,
          out: shardPaths[index],
          gameIndexOffset: runningOffset,
        };
        runningOffset += games;
        return plan;
      });
      seedWorkerOffset += chunks.length;

      await Promise.all(workerPlans.map((plan) => runDatasetWorker(
        config,
        plan.games,
        plan.out,
        plan.index,
        plan.gameIndexOffset,
        plan.seedWorkerIndex,
      )));

      const output = createWriteStream(config.out, { encoding: "utf-8", flags: "a" });
      output.setMaxListeners(0);
      try {
        for (const shardPath of shardPaths) {
          const meta = JSON.parse(await readFile(`${shardPath}.meta.json`, "utf-8"));
          totalPositions += meta.totalPositions ?? 0;
          gameHashes.push(...(meta.gameHashes ?? []));
          await appendFileToStream(shardPath, output);
        }
      } finally {
        await new Promise((resolve, reject) => {
          output.end((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }

      completedGames += stageGames;
      const checkpoint = {
        enabled: stages.length > 1,
        percent: Number(config.checkpointPercent ?? 0),
        stage: stageIndex + 1,
        stages: stages.length,
        complete: completedGames === config.games,
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(
        `${config.out}.meta.json`,
        buildParallelMeta(config, completedGames, totalPositions, gameHashes, checkpoint),
      );
      console.log(
        `[selfplay] checkpoint ${stageIndex + 1}/${stages.length} `
          + `completedGames=${completedGames}/${config.games} totalPositions=${totalPositions}`,
      );
    }

    const duplicateSummary = summarizeDuplicateHashes(gameHashes);
    console.log(
      `[selfplay] merged duplicateHashRate=${(duplicateSummary.duplicateHashRate * 100).toFixed(2)}% `
        + `duplicateGames=${duplicateSummary.duplicateGames} uniqueGames=${duplicateSummary.uniqueGames}`,
    );
    logDuplicateWarning(duplicateSummary, "merged self-play");

    console.log(`Saved ${totalPositions} samples to ${config.out} using ${config.parallel} parallel workers`);
    return {
      games: config.games,
      completedGames,
      totalPositions,
      out: config.out,
      metaPath: `${config.out}.meta.json`,
      parallel: config.parallel,
      seed: normalizeSeed(config.seed),
      gameHashes,
      duplicateSummary,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
