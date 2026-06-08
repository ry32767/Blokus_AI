import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { generateDataset } from "./generate_dataset.mjs";
import { runArena } from "./arena_runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultBrowserModel = join(root, "apps", "web", "public", "models", "blokus_policy.onnx");

function parseArgs(argv) {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const reportDir = join(root, "training", "reports", stamp);
  return {
    games: 100,
    startPolicy: "fixedStart",
    blackAi: "expert",
    whiteAi: "expert",
    blackModel: null,
    whiteModel: null,
    teacherMs: 25,
    epochs: 1,
    batchSize: 2048,
    evaluationGames: 8,
    evaluationOpponent: "expert",
    evaluationOpponentMs: 300,
    candidateMs: 500,
    datasetOut: join(reportDir, "dataset.jsonl"),
    checkpointDir: join(reportDir, "checkpoints"),
    onnxOut: join(reportDir, "candidate.onnx"),
    summaryOut: join(reportDir, "cycle-summary.json"),
    publishModel: false,
    cpu: false,
  };
}

function applyArgs(config, argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--games") config.games = Number(argv[++index]);
    if (value === "--start-policy") config.startPolicy = argv[++index];
    if (value === "--black-ai") config.blackAi = argv[++index];
    if (value === "--white-ai") config.whiteAi = argv[++index];
    if (value === "--black-model") config.blackModel = argv[++index];
    if (value === "--white-model") config.whiteModel = argv[++index];
    if (value === "--teacher-ms") config.teacherMs = Number(argv[++index]);
    if (value === "--epochs") config.epochs = Number(argv[++index]);
    if (value === "--batch-size") config.batchSize = Number(argv[++index]);
    if (value === "--evaluation-games") config.evaluationGames = Number(argv[++index]);
    if (value === "--evaluation-opponent") config.evaluationOpponent = argv[++index];
    if (value === "--evaluation-opponent-ms") config.evaluationOpponentMs = Number(argv[++index]);
    if (value === "--candidate-ms") config.candidateMs = Number(argv[++index]);
    if (value === "--dataset-out") config.datasetOut = argv[++index];
    if (value === "--checkpoint-dir") config.checkpointDir = argv[++index];
    if (value === "--onnx-out") config.onnxOut = argv[++index];
    if (value === "--summary-out") config.summaryOut = argv[++index];
    if (value === "--publish-model") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        config.publishModel = next !== "false";
        index += 1;
      } else {
        config.publishModel = true;
      }
    }
    if (value === "--cpu") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        config.cpu = next !== "false";
        index += 1;
      } else {
        config.cpu = true;
      }
    }
  }
  return config;
}

function resolvePython() {
  return join(root, "scripts", "run-python.mjs");
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

async function main() {
  const args = applyArgs(parseArgs([]), process.argv.slice(2));
  await mkdir(dirname(args.summaryOut), { recursive: true });

  await generateDataset({
    games: args.games,
    out: args.datasetOut,
    teacherMs: args.teacherMs,
    startPolicy: args.startPolicy,
    blackAi: args.blackAi,
    whiteAi: args.whiteAi,
    blackModel: args.blackModel,
    whiteModel: args.whiteModel,
  });

  const runPython = resolvePython();
  const trainArgs = [
    runPython,
    "training/train_policy.py",
    "--dataset",
    args.datasetOut,
    "--output-dir",
    args.checkpointDir,
    "--epochs",
    String(args.epochs),
    "--batch-size",
    String(args.batchSize),
  ];
  if (args.cpu) {
    trainArgs.push("--cpu");
  }
  await runNode("node", trainArgs);

  await runNode("node", [
    runPython,
    "training/export_onnx.py",
    "--checkpoint",
    join(args.checkpointDir, "policy_latest.pt"),
    "--out",
    args.onnxOut,
  ]);

  if (args.publishModel) {
    await copyFile(args.onnxOut, defaultBrowserModel);
  }

  const trainingSummary = JSON.parse(await readFile(join(args.checkpointDir, "train_summary.json"), "utf-8"));
  const arenaSummary = await runArena({
    games: args.evaluationGames,
    startPolicy: args.startPolicy,
    swapColors: true,
    alpha: {
      name: "candidate",
      spec: {
        difficulty: "learned",
        modelPath: args.onnxOut,
        timeLimitMs: args.candidateMs,
      },
    },
    beta: {
      name: args.evaluationOpponent,
      spec: {
        difficulty: args.evaluationOpponent,
        timeLimitMs: args.evaluationOpponentMs,
      },
    },
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    dataset: {
      path: args.datasetOut,
      metaPath: `${args.datasetOut}.meta.json`,
      games: args.games,
      blackAi: args.blackAi,
      whiteAi: args.whiteAi,
      teacherMs: args.teacherMs,
    },
    training: trainingSummary,
    export: {
      onnxOut: args.onnxOut,
      publishModel: args.publishModel,
      browserModelPath: args.publishModel ? defaultBrowserModel : null,
    },
    arena: arenaSummary,
  };

  await writeFile(args.summaryOut, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
