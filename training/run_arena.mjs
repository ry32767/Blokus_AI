import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runArena } from "./arena_runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    games: 8,
    startPolicy: "fixedStart",
    swapColors: true,
    alphaAi: "learned",
    alphaName: "candidate",
    alphaModel: null,
    alphaMs: 500,
    betaAi: "expert",
    betaName: "expert",
    betaModel: null,
    betaMs: 300,
    out: join(root, "training", "reports", "arena-summary.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--swap-colors") args.swapColors = argv[++index] !== "false";
    if (value === "--alpha-ai") args.alphaAi = argv[++index];
    if (value === "--alpha-name") args.alphaName = argv[++index];
    if (value === "--alpha-model") args.alphaModel = argv[++index];
    if (value === "--alpha-ms") args.alphaMs = Number(argv[++index]);
    if (value === "--beta-ai") args.betaAi = argv[++index];
    if (value === "--beta-name") args.betaName = argv[++index];
    if (value === "--beta-model") args.betaModel = argv[++index];
    if (value === "--beta-ms") args.betaMs = Number(argv[++index]);
    if (value === "--out") args.out = argv[++index];
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runArena({
    games: args.games,
    startPolicy: args.startPolicy,
    swapColors: args.swapColors,
    alpha: {
      name: args.alphaName,
      spec: {
        difficulty: args.alphaAi,
        modelPath: args.alphaModel,
        timeLimitMs: args.alphaMs,
      },
    },
    beta: {
      name: args.betaName,
      spec: {
        difficulty: args.betaAi,
        modelPath: args.betaModel,
        timeLimitMs: args.betaMs,
      },
    },
  });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(summary, null, 2));
}

await main();
