import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createSuite } from "../../../tests/testHarness.mjs";
import {
  ACTION_SIZE,
  ORIENTATIONS,
  applyMove,
  createInitialState,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
} from "../../../packages/core/src/index.js";
import { chooseLearnedMove } from "../src/ai/learnedAi.js";

const execFileAsync = promisify(execFile);
const suite = createSuite("learned-ai");

function createReducedBranchState() {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 6; i += 1) {
    state = applyMove(state, generateLegalMoves(state)[0]);
  }
  return state;
}

function fakeOrt() {
  return {
    Tensor: class Tensor {
      constructor(type, data, dims) {
        this.type = type;
        this.data = data;
        this.dims = dims;
      }
    },
  };
}

// Mirrors scripts/run-python.mjs resolution: without the PATH lookup the
// JS<->Python parity tests silently self-passed on any machine that only has
// `python3` on PATH (i.e. most Linux/CI environments).
function pythonExecutable() {
  const fileCandidates = [
    process.env.BLOKUS_PYTHON,
    process.platform === "win32"
      ? join(process.cwd(), ".venv", "Scripts", "python.exe")
      : join(process.cwd(), ".venv", "bin", "python"),
    process.platform === "win32"
      ? join(process.env.USERPROFILE || "", ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe")
      : null,
  ].filter(Boolean);
  const fromFiles = fileCandidates.find((candidate) => existsSync(candidate));
  if (fromFiles) return fromFiles;
  const pathDirs = (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":");
  for (const command of ["python3", "python"]) {
    const name = process.platform === "win32" ? `${command}.exe` : command;
    if (pathDirs.some((dir) => dir && existsSync(join(dir, name)))) return command;
  }
  return null;
}

suite.test("learned ai chooses the highest-logit legal move", async () => {
  const state = createReducedBranchState();
  const legalMoves = generateLegalMoves(state);
  const preferred = legalMoves[legalMoves.length - 1];
  const logits = new Float32Array(ACTION_SIZE).fill(-9999);
  logits[encodeAction(preferred)] = 123;

  const decision = await chooseLearnedMove(state, { difficulty: "learned" }, {
    ortModule: fakeOrt(),
    sessionFactory: async () => ({
      inputNames: ["input"],
      outputNames: ["logits"],
      run: async () => ({ logits: { data: logits } }),
    }),
  });

  assert.deepEqual(decision.move, preferred);
  assert.equal(decision.stats.engine, "learned");
});

suite.test("learned ai falls back to expert on inference failure", async () => {
  const state = createReducedBranchState();
  const decision = await chooseLearnedMove(state, { difficulty: "learned", timeLimitMs: 120 }, {
    ortModule: fakeOrt(),
    sessionFactory: async () => {
      throw new Error("model missing");
    },
  });

  assert.ok(generateLegalMoves(state).some((move) => JSON.stringify(move) === JSON.stringify(decision.move)));
  assert.equal(decision.stats.engine, "learned_fallback");
  assert.equal(decision.stats.strategy, "expert_fallback");
});

suite.test("python shared action and orientation definitions match js", async () => {
  const python = pythonExecutable();
  if (!python) {
    assert.ok(true, "python runtime not available");
    return;
  }

  const script = join(process.cwd(), "training", "inspect_shared.py");
  const summary = JSON.parse((await execFileAsync(python, [script, "summary"])).stdout.trim());
  const move = generateLegalMoves(createInitialState("fixedStart"))[0];
  const actionRoundTrip = JSON.parse((await execFileAsync(python, [script, "action", JSON.stringify(move)])).stdout.trim());

  assert.equal(summary.orientationCount, ORIENTATIONS.length);
  assert.equal(summary.actionSize, ACTION_SIZE);
  assert.equal(actionRoundTrip.action, encodeAction(move));
  assert.deepEqual(actionRoundTrip.decoded, move);
});

suite.test("python and js state encoders agree on tensor shape and values", async () => {
  const python = pythonExecutable();
  if (!python) {
    assert.ok(true, "python runtime not available");
    return;
  }

  const state = createReducedBranchState();
  const script = join(process.cwd(), "training", "inspect_shared.py");
  const jsTensor = Array.from(encodeStateTensor(state, state.currentPlayer));
  const pythonTensor = JSON.parse((
    await execFileAsync(python, [script, "encode_state", JSON.stringify(state), String(state.currentPlayer)])
  ).stdout.trim());

  assert.deepEqual(pythonTensor.shape, [51, 14, 14]);
  assert.deepEqual(pythonTensor.flat, jsTensor);
});

export default suite;
