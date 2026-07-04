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
// Session loading is delegated to modelRunner: it keys the cache by model URL
// (a module-level singleton here ignored config.modelUrl after the first call)
// and evicts rejected promises so a transient load failure doesn't disable
// the learned engine for the whole session.
import { loadModelSession, loadOrtModule, now } from "./modelRunner.js";
import { resolveRng } from "./random.js";

async function loadSession(config = {}, deps = {}) {
  return loadModelSession("policy", config, deps);
}

function selectBestLegalAction(logits, legalActions, rng) {
  let bestAction = legalActions[0];
  let bestLogit = Number.NEGATIVE_INFINITY;
  let ties = 1;

  for (const action of legalActions) {
    const value = Number(logits[action] ?? Number.NEGATIVE_INFINITY);
    if (value > bestLogit) {
      bestLogit = value;
      bestAction = action;
      ties = 1;
      continue;
    }
    if (value === bestLogit) {
      ties += 1;
      if (rng() < 1 / ties) {
        bestAction = action;
      }
    }
  }

  return { action: bestAction, value: bestLogit };
}

export async function chooseLearnedMove(state, config = {}, deps = {}) {
  const startedAt = now();
  const rng = resolveRng(config);
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
    const ort = await loadOrtModule(deps);
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
    const { action, value } = selectBestLegalAction(logits, Array.from(legalByAction.keys()), rng);
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
