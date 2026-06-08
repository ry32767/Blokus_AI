import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove,
  cloneState,
  createInitialState,
  encodeAction,
  encodeStateTensor,
  generateLegalMoves,
  scoreState,
} from "../../packages/core/src/index.js";
import {
  countCornerCandidates,
  countLegalPlacementsForPlayer,
  evaluateState,
} from "../../apps/web/src/ai/evaluation.js";
import { PIECE_SHAPES } from "../../packages/core/src/pieces.js";
import { decideTrainingMove, normalizeTrainingAiSpec } from "../ai_runtime.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function pieceCells(pieceId) {
  return PIECE_SHAPES[pieceId].length;
}

function remainingCells(state, player) {
  return state.remainingPieces[player].reduce((sum, pieceId) => sum + pieceCells(pieceId), 0);
}

function other(player) {
  return player === 0 ? 1 : 0;
}

export function hashStateForReplay(state) {
  return JSON.stringify({
    board: state.board,
    currentPlayer: state.currentPlayer,
    remainingPieces: state.remainingPieces,
    startAssignment: state.startAssignment,
    turn: state.turn,
  });
}

export function summarizeState(state, player) {
  const opponent = other(player);
  return {
    evaluation: evaluateState(state, player),
    myLegalMoves: countLegalPlacementsForPlayer(state, player),
    oppLegalMoves: countLegalPlacementsForPlayer(state, opponent),
    myCornerCandidates: countCornerCandidates(state, player),
    oppCornerCandidates: countCornerCandidates(state, opponent),
    myRemainingCells: remainingCells(state, player),
    oppRemainingCells: remainingCells(state, opponent),
  };
}

export function parseTrajectoryArgs(argv) {
  const args = {
    games: 100,
    out: join(root, "training", "dataset", "trajectories", "smoke"),
    teacherMs: 50,
    startPolicy: "fixedStart",
    blackAi: "expert",
    whiteAi: "expert",
    blackModel: null,
    whiteModel: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--games") args.games = Number(argv[++index]);
    if (value === "--out") args.out = argv[++index];
    if (value === "--teacher-ms") args.teacherMs = Number(argv[++index]);
    if (value === "--start-policy") args.startPolicy = argv[++index];
    if (value === "--ai") {
      args.blackAi = argv[++index];
      args.whiteAi = args.blackAi;
    }
    if (value === "--black-ai") args.blackAi = argv[++index];
    if (value === "--white-ai") args.whiteAi = argv[++index];
    if (value === "--black-model") args.blackModel = argv[++index];
    if (value === "--white-model") args.whiteModel = argv[++index];
  }

  return args;
}

export async function collectTrajectoryGame(config = {}) {
  const black = normalizeTrainingAiSpec({
    difficulty: config.blackAi ?? "expert",
    modelPath: config.blackModel,
    timeLimitMs: config.teacherMs ?? 50,
    label: "black",
  });
  const white = normalizeTrainingAiSpec({
    difficulty: config.whiteAi ?? "expert",
    modelPath: config.whiteModel,
    timeLimitMs: config.teacherMs ?? 50,
    label: "white",
  });
  let state = createInitialState(config.startPolicy ?? "fixedStart");
  const steps = [];

  while (state.status === "playing") {
    const player = state.currentPlayer;
    const legalMoves = generateLegalMoves(state);
    const legalActions = legalMoves.map(encodeAction);
    const before = summarizeState(state, player);
    const stateBefore = cloneState(state);
    const decision = await decideTrainingMove(state, player === 0 ? black : white);
    const action = encodeAction(decision.move);
    const next = applyMove(state, decision.move);
    const after = summarizeState(next, player);
    const stats = decision.stats ?? {};

    steps.push({
      turn: state.turn,
      player,
      actor_difficulty: player === 0 ? black.difficulty : white.difficulty,
      state: stateBefore,
      state_hash: hashStateForReplay(stateBefore),
      encoded_state: Array.from(encodeStateTensor(stateBefore, player)),
      legal_actions: legalActions,
      chosen_action: action,
      selected_action: action,
      policy_target_actions: stats.policyTargetActions ?? [action],
      policy_target_probs: stats.policyTargetProbs ?? [1],
      before,
      after,
      deltas: {
        evaluation: after.evaluation - before.evaluation,
        myLegalMoves: after.myLegalMoves - before.myLegalMoves,
        myCornerCandidates: after.myCornerCandidates - before.myCornerCandidates,
        oppLegalMoves: after.oppLegalMoves - before.oppLegalMoves,
      },
    });

    state = next;
  }

  const score = scoreState(state);
  return { steps, score, finalState: state };
}

export async function generateTrajectories(config = {}) {
  const outDir = resolve(config.out);
  await mkdir(outDir, { recursive: true });
  const trajectoryPath = join(outDir, "trajectories.jsonl");
  const stream = createWriteStream(trajectoryPath, { encoding: "utf-8" });
  let totalSteps = 0;

  try {
    for (let gameIndex = 0; gameIndex < config.games; gameIndex += 1) {
      const game = await collectTrajectoryGame(config);
      totalSteps += game.steps.length;
      const record = {
        schema_version: 1,
        game_id: `game-${String(gameIndex).padStart(6, "0")}`,
        score: game.score,
        steps: game.steps,
      };
      if (!stream.write(`${JSON.stringify(record)}\n`)) {
        await new Promise((resolveDrain) => stream.once("drain", resolveDrain));
      }
      console.log(`Trajectory ${gameIndex + 1}/${config.games}: ${game.steps.length} steps, score ${game.score[0]}-${game.score[1]}`);
    }
  } finally {
    await new Promise((resolveEnd, reject) => {
      stream.end((error) => {
        if (error) reject(error);
        else resolveEnd();
      });
    });
  }

  const summary = {
    games: config.games,
    totalSteps,
    trajectoryPath,
    blackAi: config.blackAi,
    whiteAi: config.whiteAi,
    teacherMs: config.teacherMs,
    startPolicy: config.startPolicy,
  };
  await writeFile(join(outDir, "metadata.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  return summary;
}

async function main() {
  const config = parseTrajectoryArgs(process.argv.slice(2));
  await generateTrajectories(config);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
