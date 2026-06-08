import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { generateDataset } from "./generate_dataset.mjs";
import { runArena } from "./arena_runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultBestDir = join(root, "training", "models");
const defaultBestModel = join(defaultBestDir, "best_policy_value.onnx");
const defaultBrowserModel = join(root, "apps", "web", "public", "models", "blokus_policy_value.onnx");

function parseArgs(argv) {
  const args = {
    iterations: 1,
    games: 20,
    teacherMs: 25,
    epochs: 1,
    batchSize: 2048,
    cpu: false,
    evaluationGames: 6,
    minWinRate: 0.55,
    minAverageMargin: 0.5,
    publishBest: false,
    baseReportDir: join(root, "training", "reports", "selfplay"),
    bestModelPath: defaultBestModel,
    bestDifficulty: "master",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--iterations") args.iterations = Number(argv[++index]);
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--epochs") args.epochs = Number(argv[++index]);
    if (value === "--batch-size") args.batchSize = Number(argv[++index]);
    if (value === "--cpu") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.cpu = next !== "false";
        index += 1;
      } else {
        args.cpu = true;
      }
    }
    if (value === "--evaluation-games") args.evaluationGames = Number(argv[++index]);
    if (value === "--min-win-rate") args.minWinRate = Number(argv[++index]);
    if (value === "--min-average-margin") args.minAverageMargin = Number(argv[++index]);
    if (value === "--publish-best") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.publishBest = next !== "false";
        index += 1;
      } else {
        args.publishBest = true;
      }
    }
    if (value === "--base-report-dir") args.baseReportDir = argv[++index];
    if (value === "--best-model-path") args.bestModelPath = argv[++index];
  }
  return args;
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runNode(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function runIteration(config, index, bestModelPresent) {
  const tag = `iter-${String(index + 1).padStart(3, "0")}`;
  const iterationDir = join(config.baseReportDir, tag);
  const datasetPath = join(iterationDir, "dataset.jsonl");
  const checkpointDir = join(iterationDir, "checkpoints");
  const onnxOut = join(iterationDir, "candidate_policy_value.onnx");
  const summaryOut = join(iterationDir, "iteration-summary.json");

  await generateDataset({
    games: config.games,
    out: datasetPath,
    teacherMs: config.teacherMs,
    startPolicy: "fixedStart",
    blackAi: bestModelPresent ? config.bestDifficulty : "expert",
    whiteAi: bestModelPresent ? config.bestDifficulty : "expert",
    blackModel: bestModelPresent ? config.bestModelPath : null,
    whiteModel: bestModelPresent ? config.bestModelPath : null,
  });

  await runNode("node", [
    join(root, "scripts", "run-python.mjs"),
    "training/train_policy_value.py",
    "--dataset",
    datasetPath,
    "--output-dir",
    checkpointDir,
    "--epochs",
    String(config.epochs),
    "--batch-size",
    String(config.batchSize),
    ...(config.cpu ? ["--cpu"] : []),
  ]);

  await runNode("node", [
    join(root, "scripts", "run-python.mjs"),
    "training/export_onnx.py",
    "--checkpoint",
    join(checkpointDir, "policy_value_latest.pt"),
    "--model-kind",
    "policy_value",
    "--out",
    onnxOut,
  ]);

  const opponentDifficulty = bestModelPresent ? config.bestDifficulty : "expert";
  const arena = await runArena({
    games: config.evaluationGames,
    startPolicy: "fixedStart",
    swapColors: true,
    alpha: {
      name: "candidate",
      spec: {
        difficulty: config.bestDifficulty,
        modelPath: onnxOut,
        timeLimitMs: 1200,
      },
    },
    beta: {
      name: bestModelPresent ? "best" : "expert",
      spec: {
        difficulty: opponentDifficulty,
        modelPath: bestModelPresent ? config.bestModelPath : null,
        timeLimitMs: 1200,
      },
    },
  });

  const candidate = arena.contestants.candidate;
  const winRate = candidate.wins / Math.max(1, config.evaluationGames);
  const promote = winRate >= config.minWinRate && candidate.averageMargin >= config.minAverageMargin;

  const summary = {
    iteration: index + 1,
    datasetPath,
    checkpointDir,
    onnxOut,
    arena,
    promote,
    winRate,
  };
  await writeFile(summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  if (promote) {
    await mkdir(dirname(config.bestModelPath), { recursive: true });
    await copyFile(onnxOut, config.bestModelPath);
    if (config.publishBest) {
      await copyFile(onnxOut, defaultBrowserModel);
    }
  }

  return summary;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  await mkdir(config.baseReportDir, { recursive: true });
  let bestModelPresent = await exists(config.bestModelPath);
  const summaries = [];

  for (let index = 0; index < config.iterations; index += 1) {
    const summary = await runIteration(config, index, bestModelPresent);
    summaries.push(summary);
    if (summary.promote) {
      bestModelPresent = true;
    }
  }

  const loopSummary = {
    generatedAt: new Date().toISOString(),
    iterations: summaries,
    bestModelPath: config.bestModelPath,
    publishBest: config.publishBest,
    browserModelPath: config.publishBest ? defaultBrowserModel : null,
  };
  await writeFile(join(config.baseReportDir, "loop-summary.json"), `${JSON.stringify(loopSummary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(loopSummary, null, 2));
}

await main();
