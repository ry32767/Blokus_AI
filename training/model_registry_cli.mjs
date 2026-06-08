import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureModelRegistry, getActiveModel, listModels, promoteModel } from "./model_registry.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    command: "status",
    registryDir: join(root, "training", "model_registry"),
    modelId: null,
  };
  if (argv[0] && !argv[0].startsWith("--")) {
    args.command = argv[0];
    argv = argv.slice(1);
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--registry-dir") args.registryDir = argv[++index];
    if (value === "--model-id") args.modelId = argv[++index];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "status") {
    const context = await ensureModelRegistry(args.registryDir);
    const active = await getActiveModel(args.registryDir);
    console.log(JSON.stringify({
      registryPath: context.registryPath,
      activeModel: active,
      modelCount: context.registry.models.length,
    }, null, 2));
    return;
  }
  if (args.command === "list") {
    console.log(JSON.stringify(await listModels(args.registryDir), null, 2));
    return;
  }
  if (args.command === "promote") {
    if (!args.modelId) throw new Error("--model-id is required for promote");
    console.log(JSON.stringify(await promoteModel(args.registryDir, args.modelId, { reason: "manual CLI promotion" }), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

await main();
