// One-command full AlphaZero training campaign for BlokusAI Duo.
//
//   npm run train:full -- --smoke      # tiny dry-run of the WHOLE pipeline (~minutes)
//   npm run train:full                 # real campaign (large net, GPU, many iterations)
//   npm run train:full -- --resume     # continue an interrupted real campaign
//
// It runs two phases against ONE shared registry / replay buffer / report dir:
//   Phase 1 (cold-start warm-up): self-play with the strong search AI (expert_plus),
//     because the committed ONNX models are from the old corner-start variant and must
//     not seed the new official-rules run. The first trained net is bootstrapped as
//     best-0 (see run_alphazero_loop.mjs).
//   Phase 2 (self-play): resume and self-play from the trained best (master), with
//     Dirichlet+temperature exploration and the SPRT promotion gate.
//
// See docs/TRAINING_WORKFLOW.md. This is the entry point you run when you are ready to
// "do full training to the end" — watch progress with `npm run view:selfplay`.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const smoke = argv.includes("--smoke");
  const resume = argv.includes("--resume");
  const cpu = argv.includes("--cpu");
  const onlyPhase1 = argv.includes("--phase1");
  const onlyPhase2 = argv.includes("--phase2");
  // Recommended real-run defaults for a single mid-range GPU (e.g. RTX 4060 Ti).
  const real = {
    netSize: "large",
    warmupIterations: 2,
    iterations: 30,
    workers: 4,
    games: 200,
    teacherMs: 300,
    epochs: 4,
    sampleSize: 8192,
    batchSize: 4096,
    evaluationGames: 120,
    baseDir: join(root, "training", "runs", "full"),
    cpu: false,
  };
  const smokeCfg = {
    netSize: "small",
    warmupIterations: 1,
    iterations: 1,
    workers: 2,
    games: 4,
    teacherMs: 40,
    epochs: 1,
    sampleSize: 256,
    batchSize: 64,
    evaluationGames: 4,
    baseDir: join(root, "training", ".scratch", "full-smoke"),
    cpu: true,
  };
  const base = smoke ? smokeCfg : real;
  const out = { ...base, smoke, resume, cpu: cpu || base.cpu, onlyPhase1, onlyPhase2 };
  // Allow --key value overrides. Numeric keys are coerced; netSize/baseDir stay strings.
  const map = {
    "--net-size": "netSize",
    "--warmup-iterations": "warmupIterations",
    "--iterations": "iterations",
    "--workers": "workers",
    "--games": "games",
    "--teacher-ms": "teacherMs",
    "--epochs": "epochs",
    "--sample-size": "sampleSize",
    "--batch-size": "batchSize",
    "--evaluation-games": "evaluationGames",
    "--base-dir": "baseDir",
  };
  const stringKeys = new Set(["netSize", "baseDir"]);
  for (let i = 0; i < argv.length; i += 1) {
    const key = map[argv[i]];
    if (key) {
      const raw = argv[++i];
      out[key] = stringKeys.has(key) ? raw : Number(raw);
    }
  }
  return out;
}

function runLoop(label, extraArgs) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== ${label} ===\n$ node training/run_alphazero_loop.mjs ${extraArgs.join(" ")}\n`);
    const child = spawn("node", [join(root, "training", "run_alphazero_loop.mjs"), ...extraArgs], {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, BLOKUS_ORT_THREADS: process.env.BLOKUS_ORT_THREADS ?? "1" },
    });
    child.on("exit", (code) => ((code ?? 1) === 0 ? resolve() : reject(new Error(`${label} exited with ${code}`))));
  });
}

function sharedArgs(cfg) {
  return [
    "--workers", String(cfg.workers),
    "--games", String(cfg.games),
    "--teacher-ms", String(cfg.teacherMs),
    "--epochs", String(cfg.epochs),
    "--sample-size", String(cfg.sampleSize),
    "--batch-size", String(cfg.batchSize),
    "--net-size", cfg.netSize,
    "--evaluation-games", String(cfg.evaluationGames),
    "--replay-buffer-dir", join(cfg.baseDir, "replay_buffer"),
    "--registry-dir", join(cfg.baseDir, "model_registry"),
    "--base-report-dir", join(cfg.baseDir, "runs"),
    ...(cfg.cpu ? ["--cpu"] : []),
  ];
}

const USAGE = `BlokusAI Duo — full training campaign

  npm run train:full -- --smoke      # tiny end-to-end dry-run (validate the pipeline)
  npm run train:full                 # REAL campaign: Phase 1 then Phase 2 in one go
  npm run train:full -- --resume     # continue an interrupted real campaign

Run the two phases as separate commands (same shared registry / buffer / report dir):
  npm run train:full -- --phase1     # Phase 1 only: cold-start warm-up -> bootstrap best-0
  npm run train:full -- --phase2     # Phase 2 only: resume + master self-play + SPRT
  (run --phase1 first; --phase2 resumes from the best it seeded. Re-run --phase2 to continue.)

Overrides: --net-size --warmup-iterations --iterations --workers --games --teacher-ms
           --epochs --sample-size --batch-size --evaluation-games --base-dir --cpu
A bare \`train:full\` (no --smoke) starts the REAL, long, compute-heavy run.
See docs/TRAINING_WORKFLOW.md.`;

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const cfg = parseArgs(rawArgs);
  if (cfg.onlyPhase1 && cfg.onlyPhase2) {
    console.error("Use either --phase1 or --phase2, not both (omit both to run the full campaign).");
    process.exit(1);
  }
  // Which phases to run this invocation. Default (neither flag) = both.
  const runP1 = !cfg.onlyPhase2 && !cfg.resume;
  const runP2 = !cfg.onlyPhase1;
  const phaseLabel = cfg.onlyPhase1 ? "phase 1 only" : cfg.onlyPhase2 ? "phase 2 only" : "phase 1 + 2";
  console.log("BlokusAI Duo — full training campaign");
  console.log(JSON.stringify({
    mode: cfg.smoke ? "smoke (dry-run)" : "real",
    phases: phaseLabel,
    netSize: cfg.netSize,
    warmupIterations: cfg.warmupIterations,
    mainIterations: cfg.iterations,
    workers: cfg.workers,
    gamesPerIteration: cfg.games,
    epochs: cfg.epochs,
    evaluationGames: cfg.evaluationGames,
    device: cfg.cpu ? "cpu" : "gpu",
    baseDir: cfg.baseDir,
    resume: cfg.resume,
  }, null, 2));
  if (!cfg.smoke) {
    console.log("\nThis is a long, compute-heavy run. Watch it with `npm run view:selfplay -- --summary <run>/train_summary.json`.");
  }

  // Phase 1: cold-start warm-up via expert_plus self-play (seeds best-0). Skipped on
  // --resume or --phase2 (the registry already holds an active best from a prior run).
  if (runP1) {
    await runLoop("Phase 1: cold-start warm-up (expert_plus self-play)", [
      "--iterations", String(cfg.warmupIterations),
      "--selfplay-ai", "expert_plus",
      ...sharedArgs(cfg),
    ]);
  } else if (runP2) {
    console.log("\n[resume] skipping Phase 1 warm-up; continuing the main self-play loop.");
  }

  // Phase 2: iterated self-play from the trained best (master) with SPRT gating.
  if (runP2) {
    await runLoop("Phase 2: self-play campaign (master + SPRT, resumable)", [
      "--resume",
      "--iterations", String(cfg.iterations),
      "--selfplay-ai", "master",
      "--gate-mode", "sprt",
      ...sharedArgs(cfg),
    ]);
  }

  if (cfg.onlyPhase1) {
    console.log(`\nPhase 1 done. Best-0 seeded under ${cfg.baseDir}/model_registry. ` +
      `Continue with:\n  npm run train:full -- --phase2`);
    return;
  }

  console.log(`\nDone. Best model + history under ${cfg.baseDir}. ` +
    `Publish a chosen candidate with:\n  npm run export:onnx:pv -- --checkpoint <…/policy_value_best.pt> --out apps/web/public/models/blokus_policy_value.onnx`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
