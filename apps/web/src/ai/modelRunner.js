import { BOARD_SIZE, STATE_PLANES, encodeStateTensor } from "../../../../packages/core/src/index.js";

const defaultPolicyModelUrl = new URL("../../public/models/blokus_policy.onnx", import.meta.url).href;
const defaultPolicyValueModelUrl = new URL("../../public/models/blokus_policy_value.onnx", import.meta.url).href;
const wasmBaseUrl = new URL("../../public/vendor/onnxruntime-web/", import.meta.url).href;
const sessionCache = new Map();
let ortModulePromise = null;

export function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

export async function loadOrtModule(deps = {}) {
  if (deps.ortModule) return deps.ortModule;
  if (!ortModulePromise) {
    ortModulePromise = import(new URL("../../public/vendor/onnxruntime-web/ort.min.mjs", import.meta.url));
    // Do not cache a rejected promise: a transient load failure would
    // otherwise disable ORT for the whole session.
    ortModulePromise.catch(() => {
      ortModulePromise = null;
    });
  }
  return ortModulePromise;
}

function sessionCacheKey(kind, modelUrl) {
  return `${kind}:${modelUrl}`;
}

async function createSession(kind, modelUrl, deps = {}) {
  if (deps.sessionFactory) {
    return deps.sessionFactory();
  }
  const ort = await loadOrtModule(deps);
  if (ort.env?.wasm) {
    ort.env.wasm.wasmPaths = wasmBaseUrl;
  }
  return ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

export async function loadModelSession(kind, config = {}, deps = {}) {
  const modelUrl = config.modelUrl ?? config.modelPath ?? (
    kind === "policy_value"
      ? config.policyValueModelUrl ?? defaultPolicyValueModelUrl
      : config.policyModelUrl ?? defaultPolicyModelUrl
  );
  if (deps.sessionFactory) {
    return createSession(kind, modelUrl, deps);
  }
  const key = sessionCacheKey(kind, modelUrl);
  if (!sessionCache.has(key)) {
    const sessionPromise = createSession(kind, modelUrl, deps);
    // Evict on rejection so one flaky fetch doesn't permanently poison the
    // cache and silently downgrade learned/master to the heuristic fallback.
    sessionPromise.catch(() => {
      if (sessionCache.get(key) === sessionPromise) sessionCache.delete(key);
    });
    sessionCache.set(key, sessionPromise);
  }
  return sessionCache.get(key);
}

function createInputTensor(ort, state, player) {
  return new ort.Tensor(
    "float32",
    encodeStateTensor(state, player),
    [1, STATE_PLANES, BOARD_SIZE, BOARD_SIZE],
  );
}

export async function inferPolicy(state, player, config = {}, deps = {}) {
  const ort = await loadOrtModule(deps);
  const session = await loadModelSession("policy", config, { ...deps, ortModule: ort });
  const inputTensor = createInputTensor(ort, state, player);
  const outputs = await session.run({ [session.inputNames[0] ?? "input"]: inputTensor });
  const outputName = session.outputNames?.[0] ?? Object.keys(outputs)[0];
  return {
    logits: outputs[outputName].data,
    outputName,
  };
}

export async function inferPolicyValue(state, player, config = {}, deps = {}) {
  const ort = await loadOrtModule(deps);
  const session = await loadModelSession("policy_value", config, { ...deps, ortModule: ort });
  const inputTensor = createInputTensor(ort, state, player);
  const outputs = await session.run({ [session.inputNames[0] ?? "input"]: inputTensor });
  const policyName = session.outputNames?.[0] ?? Object.keys(outputs)[0];
  const valueName = session.outputNames?.[1] ?? Object.keys(outputs)[1];
  return {
    logits: outputs[policyName].data,
    value: Number(outputs[valueName].data[0] ?? 0),
    policyName,
    valueName,
  };
}

export function clearModelSessionCache() {
  sessionCache.clear();
}

export function getDefaultPolicyModelUrl() {
  return defaultPolicyModelUrl;
}

export function getDefaultPolicyValueModelUrl() {
  return defaultPolicyValueModelUrl;
}
