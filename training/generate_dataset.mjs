import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove,
  createInitialState,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
  scoreState,
} from "../packages/core/src/index.js";
import { chooseExpertMove } from "../apps/web/src/ai/expertAi.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = {
    games: 100,
    out: join(root, "training", "data", "smoke-expert-100.jsonl"),
    teacherMs: 25,
    startPolicy: "fixedStart",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--out") args.out = argv[++index];
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
  }

  return args;
}

async function playExpertGame(config) {
  let state = createInitialState(config.startPolicy);
  const samples = [];

  while (state.status === "playing") {
    const currentPlayer = state.currentPlayer;
    const legalMoves = generateLegalMoves(state);
    const decision = await chooseExpertMove(state, {
      difficulty: "expert",
      timeLimitMs: config.teacherMs,
      maxThinkingMs: config.teacherMs,
      candidateLimit: 48,
      maxChildren: 48,
      simulations: 48,
      maxDepth: 6,
    });
    const legalActions = legalMoves.map(encodeAction);
    samples.push({
      player: currentPlayer,
      encoded_state: Array.from(encodeStateTensor(state, currentPlayer)),
      legal_actions: legalActions,
      expert_selected_action: encodeAction(decision.move),
      final_score_diff: 0,
    });
    state = applyMove(state, decision.move);
  }

  const [blackScore, whiteScore] = scoreState(state);
  for (const sample of samples) {
    sample.final_score_diff = sample.player === 0
      ? blackScore - whiteScore
      : whiteScore - blackScore;
  }

  return { state, samples, score: [blackScore, whiteScore] };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const records = [];
  let totalPositions = 0;

  for (let gameIndex = 0; gameIndex < config.games; gameIndex += 1) {
    const { samples, score } = await playExpertGame(config);
    totalPositions += samples.length;
    records.push(...samples);
    console.log(`Generated game ${gameIndex + 1}/${config.games} (${samples.length} positions, score ${score[0]}-${score[1]})`);
  }

  await mkdir(dirname(config.out), { recursive: true });
  await writeFile(
    config.out,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await writeFile(
    `${config.out}.meta.json`,
    `${JSON.stringify({
      games: config.games,
      totalPositions,
      teacher: "expert",
      teacherMs: config.teacherMs,
      startPolicy: config.startPolicy,
    }, null, 2)}\n`,
  );

  console.log(`Saved ${records.length} samples to ${config.out}`);
}

await main();
