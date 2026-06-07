import {
  ACTION_SIZE,
  BOARD_SIZE,
  PASS_ACTION,
  STATE_PLANES,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
} from "../../../../packages/core/src/index.js";
import { chooseExpertMove } from "./expertAi.js";

let sessionPromise = null;

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

async function loadOrtModule() {
  return import(new URL("../../public/vendor/onnxruntime-web/ort.min.mjs", import.meta.url));
}

async function loadSession(config = {}, deps = {}) {
  if (deps.sessionFactory) {
    return deps.sessionFactory();
  }

  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = deps.ortModule ?? await loadOrtModule();
      const wasmBase = new URL("../../public/vendor/onnxruntime-web/", import.meta.url).href;
      if (ort.env?.wasm) {
        ort.env.wasm.wasmPaths = wasmBase;
      }
      return ort.InferenceSession.create(
        config.modelUrl ?? new URL("../../public/models/blokus_policy.onnx", import.meta.url).href,
        {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        },
      );
    })();
  }

  return sessionPromise;
}

function selectBestLegalAction(logits, legalActions) {
  let bestAction = legalActions[0];
  let bestLogit = Number.NEGATIVE_INFINITY;

  for (const action of legalActions) {
    const value = Number(logits[action] ?? Number.NEGATIVE_INFINITY);
    if (value > bestLogit) {
      bestLogit = value;
      bestAction = action;
    }
  }

  return { action: bestAction, value: bestLogit };
}

export async function chooseLearnedMove(state, config = {}, deps = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: "learned",
        engine: "learned",
        strategy: "pass",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: PASS_ACTION,
        moveKind: "pass",
      },
    };
  }

  const legalByAction = new Map(legalMoves.map((move) => [encodeAction(move), move]));

  try {
    const ort = deps.ortModule ?? await loadOrtModule();
    const session = await loadSession(config, { ...deps, ortModule: ort });
    const inputTensor = new ort.Tensor(
      "float32",
      encodeStateTensor(state, state.currentPlayer),
      [1, STATE_PLANES, BOARD_SIZE, BOARD_SIZE],
    );
    const outputs = await session.run({ [session.inputNames[0] ?? "input"]: inputTensor });
    const outputName = session.outputNames?.[0] ?? Object.keys(outputs)[0];
    const logits = outputs[outputName].data;
    if (!logits || logits.length !== ACTION_SIZE) {
      throw new Error(`Unexpected logits shape: ${logits?.length ?? "none"}`);
    }
    const { action, value } = selectBestLegalAction(logits, Array.from(legalByAction.keys()));
    return {
      move: legalByAction.get(action),
      stats: {
        difficulty: "learned",
        engine: "learned",
        strategy: "policy_argmax",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: legalMoves.length,
        selectedAction: action,
        selectedPieceId: legalByAction.get(action)?.pieceId,
        value: Number(value.toFixed(4)),
      },
    };
  } catch (error) {
    const fallback = await chooseExpertMove(state, {
      ...config,
      difficulty: "learned",
      timeLimitMs: Math.min(config.timeLimitMs ?? config.maxThinkingMs ?? 800, 800),
      maxThinkingMs: Math.min(config.timeLimitMs ?? config.maxThinkingMs ?? 800, 800),
    });
    return {
      ...fallback,
      stats: {
        ...fallback.stats,
        difficulty: "learned",
        engine: "learned_fallback",
        strategy: "expert_fallback",
        fallbackReason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
