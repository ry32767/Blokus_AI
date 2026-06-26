import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const preset = process.argv[2];
const rest = process.argv.slice(3);
const useCpu = rest.includes("--cpu");

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n$ ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code) => {
      if ((code ?? 1) === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function npmScript(script, args = []) {
  return run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", script, "--", ...args]);
}

function maybeCpu(args) {
  return useCpu ? [...args, "--cpu"] : args;
}

if (!preset) {
  throw new Error("Usage: npm run preset:<name>. Available presets: smoke:learning, smoke:critical");
}

// All smoke artifacts go under the gitignored scratch sandbox so they never clutter
// training/ or overwrite the committed browser model. See docs/TRAINING_WORKFLOW.md.
const SCRATCH = "training/.scratch";

if (preset === "smoke:learning") {
  const base = `${SCRATCH}/smoke-learning`;
  await npmScript("generate:orientations");
  await npmScript("generate:dataset", [
    "--games", "100",
    "--out", `${base}/dataset.jsonl`,
    "--teacher-ms", "10",
    "--start-policy", "fixedStart",
  ]);
  await npmScript("train:policy", maybeCpu([
    "--dataset", `${base}/dataset.jsonl`,
    "--epochs", "1",
    "--output-dir", `${base}/policy`,
    "--batch-size", "2048",
  ]));
  await npmScript("train:policy-value", maybeCpu([
    "--dataset", `${base}/dataset.jsonl`,
    "--epochs", "1",
    "--output-dir", `${base}/policy-value`,
    "--batch-size", "2048",
  ]));
  await npmScript("export:onnx", [
    "--checkpoint", `${base}/policy/policy_latest.pt`,
    "--out", `${base}/blokus_policy.onnx`,
  ]);
  // NOTE: a 100-game smoke must NOT overwrite the published browser model.
  await npmScript("export:onnx:pv", [
    "--checkpoint", `${base}/policy-value/policy_value_latest.pt`,
    "--out", `${base}/blokus_policy_value.onnx`,
  ]);
} else if (preset === "smoke:critical") {
  const base = `${SCRATCH}/smoke-critical`;
  await npmScript("generate:trajectory", [
    "--games", "10",
    "--ai", "expert",
    "--teacher-ms", "50",
    "--out", `${base}/trajectories`,
  ]);
  await npmScript("generate:critical-replay", [
    "--trajectories", `${base}/trajectories`,
    "--out", `${base}/critical_replay`,
    "--critical-states-per-game", "2",
    "--top-k-actions", "4",
    "--playouts-per-action", "1",
    "--teacher", "master",
    "--teacher-ms", "300",
    "--teacher-model", "apps/web/public/models/blokus_policy_value.onnx",
  ]);
  await npmScript("train:policy-value", maybeCpu([
    "--dataset", `${base}/critical_replay/records.jsonl`,
    "--epochs", "1",
    "--output-dir", `${base}/checkpoints`,
    "--batch-size", "512",
  ]));
} else {
  throw new Error(`Unknown preset: ${preset}`);
}
