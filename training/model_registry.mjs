import { copyFile } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix, index) {
  return `${prefix}-${String(index).padStart(4, "0")}`;
}

export function createEmptyRegistry(registryDir) {
  return {
    version: 1,
    generatedAt: nowIso(),
    registryDir,
    activeModelId: null,
    nextModelIndex: 1,
    models: [],
    promotions: [],
  };
}

function defaultRating(options = {}) {
  return Number(options.rating ?? 1200);
}

export async function ensureModelRegistry(registryDir) {
  const resolvedDir = resolve(registryDir);
  const registryPath = join(resolvedDir, "registry.json");
  const modelsDir = join(resolvedDir, "models");
  await mkdir(modelsDir, { recursive: true });
  try {
    const registry = JSON.parse(await readFile(registryPath, "utf-8"));
    return { registryDir: resolvedDir, registryPath, modelsDir, registry };
  } catch {
    const registry = createEmptyRegistry(resolvedDir);
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
    return { registryDir: resolvedDir, registryPath, modelsDir, registry };
  }
}

async function saveRegistry(context) {
  context.registry.generatedAt = nowIso();
  await writeFile(context.registryPath, `${JSON.stringify(context.registry, null, 2)}\n`, "utf-8");
}

export async function registerModel(registryDir, sourceModelPath, options = {}) {
  const context = await ensureModelRegistry(registryDir);
  const modelId = options.modelId ?? makeId("model", context.registry.nextModelIndex);
  const destinationPath = join(context.modelsDir, `${modelId}.onnx`);
  await copyFile(sourceModelPath, destinationPath);

  const entry = {
    id: modelId,
    createdAt: nowIso(),
    kind: options.kind ?? "policy_value",
    file: destinationPath,
    parentModelId: options.parentModelId ?? null,
    source: options.source ?? "manual",
    status: options.status ?? "candidate",
    notes: options.notes ?? null,
    metrics: options.metrics ?? null,
    arenaSummaryPath: options.arenaSummaryPath ?? null,
    trainingSummaryPath: options.trainingSummaryPath ?? null,
    rating: defaultRating(options),
    ratingGames: Number(options.ratingGames ?? 0),
    ratingHistory: Array.isArray(options.ratingHistory) ? options.ratingHistory : [],
  };

  context.registry.models.push(entry);
  context.registry.nextModelIndex += 1;
  if (entry.status === "active") {
    context.registry.activeModelId = entry.id;
  }
  await saveRegistry(context);
  return entry;
}

export async function getActiveModel(registryDir) {
  const { registry } = await ensureModelRegistry(registryDir);
  return registry.models.find((entry) => entry.id === registry.activeModelId) ?? null;
}

export async function promoteModel(registryDir, modelId, options = {}) {
  const context = await ensureModelRegistry(registryDir);
  const target = context.registry.models.find((entry) => entry.id === modelId);
  if (!target) {
    throw new Error(`Model "${modelId}" not found in registry.`);
  }
  const previousId = context.registry.activeModelId;
  for (const entry of context.registry.models) {
    if (entry.id === modelId) {
      entry.status = "active";
      entry.metrics = options.metrics ?? entry.metrics;
      entry.arenaSummaryPath = options.arenaSummaryPath ?? entry.arenaSummaryPath;
      entry.rating = Number(options.rating ?? entry.rating ?? 1200);
      entry.ratingGames = Number(options.ratingGames ?? entry.ratingGames ?? 0);
      if (options.ratingHistoryEntry) {
        entry.ratingHistory = [...(entry.ratingHistory ?? []), options.ratingHistoryEntry];
      }
    } else if (entry.status === "active") {
      entry.status = "archived";
      if (options.opponentRating != null) {
        entry.rating = Number(options.opponentRating);
      }
      if (options.opponentRatingGames != null) {
        entry.ratingGames = Number(options.opponentRatingGames);
      }
      if (options.opponentRatingHistoryEntry) {
        entry.ratingHistory = [...(entry.ratingHistory ?? []), options.opponentRatingHistoryEntry];
      }
    }
  }
  context.registry.activeModelId = modelId;
  context.registry.promotions.push({
    promotedAt: nowIso(),
    fromModelId: previousId,
    toModelId: modelId,
    reason: options.reason ?? "promotion",
    metrics: options.metrics ?? null,
  });
  await saveRegistry(context);
  return target;
}

export async function listModels(registryDir) {
  const { registry } = await ensureModelRegistry(registryDir);
  return registry.models;
}
