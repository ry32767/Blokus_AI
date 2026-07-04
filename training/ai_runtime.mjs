import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decideDifficultyMove, normalizeAiConfig } from "../apps/web/src/ai/difficulty.js";
import { chooseLearnedMove } from "../apps/web/src/ai/learnedAi.js";
import { chooseMasterMove } from "../apps/web/src/ai/policyValueMctsAi.js";
import { isLegalMove } from "../packages/core/src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultModelPath = join(root, "apps", "web", "public", "models", "blokus_policy.onnx");
const sessionCache = new Map();

// ONNX backend resolution for LOCAL self-play/training (the browser uses
// onnxruntime-web directly via modelRunner.js). Prefer the native onnxruntime-node
// backend when installed — it is several times faster than WASM for self-play — and
// fall back to onnxruntime-web. Override with BLOKUS_ORT_BACKEND=node|web|auto.
const ortBackendPref = String(process.env.BLOKUS_ORT_BACKEND ?? "auto").toLowerCase();
let ortModulePromise = null;
let resolvedOrtBackend = null;

async function loadOrt() {
  if (!ortModulePromise) {
    ortModulePromise = (async () => {
      if (ortBackendPref !== "web") {
        try {
          const mod = await import("onnxruntime-node");
          resolvedOrtBackend = "onnxruntime-node";
          return mod.default ?? mod;
        } catch (error) {
          if (ortBackendPref === "node") throw error;
        }
      }
      const web = await import("onnxruntime-web");
      resolvedOrtBackend = "onnxruntime-web";
      const ort = web.default ?? web;
      const threads = Number(process.env.BLOKUS_ORT_THREADS ?? 0);
      if (Number.isInteger(threads) && threads > 0 && ort.env?.wasm) {
        ort.env.wasm.numThreads = threads;
      }
      return ort;
    })();
  }
  return ortModulePromise;
}

export function getResolvedOrtBackend() {
  return resolvedOrtBackend;
}

function sessionOptions() {
  // onnxruntime-node uses the native CPU EP by default; onnxruntime-web needs wasm.
  return resolvedOrtBackend === "onnxruntime-web"
    ? { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
    : { graphOptimizationLevel: "all" };
}

export const TRAINING_AI_DIFFICULTIES = ["easy", "normal", "hard", "expert", "expert_plus", "learned", "master"];

function normalizeDifficulty(value) {
  if (!value) return "expert";
  const lower = String(value).trim().toLowerCase();
  return TRAINING_AI_DIFFICULTIES.includes(lower) ? lower : "expert";
}

function normalizeModelPath(modelPath) {
  if (!modelPath) return null;
  return isAbsolute(modelPath) ? modelPath : resolve(root, modelPath);
}

export function normalizeTrainingAiSpec(spec = {}) {
  const difficulty = normalizeDifficulty(spec.difficulty ?? spec.engine);
  const timeLimitMs = Math.max(1, Number(spec.timeLimitMs ?? spec.maxThinkingMs ?? (
    difficulty === "expert_plus" ? 4000
      : difficulty === "master" ? 2500
      : difficulty === "expert" ? 1500
      : difficulty === "hard" ? 800
      : difficulty === "learned" ? 500
      : 300
  )));

  return {
    label: spec.label ?? difficulty,
    difficulty,
    engine: difficulty,
    timeLimitMs,
    maxThinkingMs: timeLimitMs,
    modelPath: normalizeModelPath(spec.modelPath),
    // Training/arena runs of model-backed actors must hard-fail when the model
    // cannot actually be used: a silent fall-back to the heuristic engine
    // mislabels self-play data and lets the promotion gate measure the wrong
    // player. Callers can still opt out explicitly (failOnFallback: false).
    failOnFallback: spec.failOnFallback ?? (difficulty === "learned" || difficulty === "master"),
    ...spec,
    difficulty,
    engine: difficulty,
    timeLimitMs,
    maxThinkingMs: timeLimitMs,
    modelPath: normalizeModelPath(spec.modelPath),
  };
}

async function loadCachedSession(resolvedPath) {
  if (!sessionCache.has(resolvedPath)) {
    const ort = await loadOrt();
    const sessionPromise = ort.InferenceSession.create(resolvedPath, sessionOptions());
    // Evict on rejection: a cached rejected promise would poison every later
    // attempt for the process lifetime.
    sessionPromise.catch(() => {
      if (sessionCache.get(resolvedPath) === sessionPromise) sessionCache.delete(resolvedPath);
    });
    sessionCache.set(resolvedPath, sessionPromise);
  }
  return sessionCache.get(resolvedPath);
}

async function loadLearnedSession(modelPath) {
  return loadCachedSession(normalizeModelPath(modelPath) ?? defaultModelPath);
}

async function loadPolicyValueSession(modelPath) {
  return loadCachedSession(
    normalizeModelPath(modelPath) ?? join(root, "apps", "web", "public", "models", "blokus_policy_value.onnx"),
  );
}

export async function decideTrainingMove(state, spec = {}) {
  const normalized = normalizeTrainingAiSpec(spec);
  let decision;

  if (normalized.difficulty === "learned") {
    const session = await loadLearnedSession(normalized.modelPath);
    decision = await chooseLearnedMove(state, normalized, {
      ortModule: await loadOrt(),
      sessionFactory: async () => session,
    });
  } else if (normalized.difficulty === "master") {
    const session = await loadPolicyValueSession(normalized.modelPath);
    decision = await chooseMasterMove(state, normalized, {
      ortModule: await loadOrt(),
      sessionFactory: async () => session,
    });
  } else {
    decision = await decideDifficultyMove(state, normalizeAiConfig(normalized));
  }

  if (!isLegalMove(state, decision.move)) {
    throw new Error(`AI "${normalized.label}" returned an illegal move.`);
  }

  // A model load/shape/inference failure silently substitutes the heuristic expert
  // engine. That move is legal, so it slips past the check above and would otherwise
  // blind the arena gate (broken candidate measured as expert) and pollute self-play
  // data. Callers that require a real model (arena, self-play) can opt into hard-fail.
  const engine = decision.stats?.engine ?? "";
  if (engine.endsWith("_fallback") && (normalized.failOnFallback || spec.failOnFallback)) {
    throw new Error(
      `AI "${normalized.label}" (${normalized.difficulty}) fell back to the heuristic engine: `
        + `${decision.stats?.fallbackReason ?? "unknown reason"}`,
    );
  }

  return decision;
}

export function clearTrainingSessionCache() {
  sessionCache.clear();
}

export function getDefaultLearnedModelPath() {
  return defaultModelPath;
}
