// Terminal self-play viewer — watch the AI play, move by move, on a 14x14 board.
//
//   npm run view:selfplay -- --black-ai master --white-ai expert --delay-ms 400
//   npm run view:selfplay -- --replay path/to/game.json
//   npm run view:selfplay -- --summary training/.../train_summary.json
//
// Goal: a human-visible window into training. Run a quick self-play between any two
// difficulties (optionally with ONNX models), or replay a saved game, or render a
// training run's metric history. See docs/TRAINING_WORKFLOW.md.
import { readFile } from "node:fs/promises";
import {
  BOARD_SIZE,
  START_POINTS,
  applyMove,
  createInitialState,
  generateLegalMoves,
  getCellsForMove,
  scoreState,
} from "../packages/core/src/index.js";
import { decideTrainingMove } from "./ai_runtime.mjs";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  black: "\x1b[44m\x1b[97m", // blue bg = player 0 (Black)
  white: "\x1b[41m\x1b[97m", // red bg  = player 1 (White)
  blackHi: "\x1b[104m\x1b[30m",
  whiteHi: "\x1b[101m\x1b[30m",
  star: "\x1b[33m",
  green: "\x1b[32m",
};

function parseArgs(argv) {
  const args = {
    blackAi: "master",
    whiteAi: "expert",
    blackModel: null,
    whiteModel: null,
    teacherMs: 400,
    delayMs: 350,
    startPolicy: "fixedStart",
    maxMoves: 200,
    seed: 0,
    replay: null,
    summary: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === "--black-ai") args.blackAi = argv[++i];
    else if (v === "--white-ai") args.whiteAi = argv[++i];
    else if (v === "--black-model") args.blackModel = argv[++i];
    else if (v === "--white-model") args.whiteModel = argv[++i];
    else if (v === "--teacher-ms") args.teacherMs = Number(argv[++i]);
    else if (v === "--delay-ms") args.delayMs = Number(argv[++i]);
    else if (v === "--start-policy") args.startPolicy = argv[++i];
    else if (v === "--max-moves") args.maxMoves = Number(argv[++i]);
    else if (v === "--seed") args.seed = Number(argv[++i]);
    else if (v === "--replay") args.replay = argv[++i];
    else if (v === "--summary") args.summary = argv[++i];
  }
  return args;
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function isStart(x, y) {
  return (
    (x === START_POINTS.A.x && y === START_POINTS.A.y) ||
    (x === START_POINTS.B.x && y === START_POINTS.B.y)
  );
}

function renderBoard(state, lastCells = []) {
  const last = new Set(lastCells.map((c) => `${c.x},${c.y}`));
  const lines = [];
  let header = "    ";
  for (let x = 0; x < BOARD_SIZE; x += 1) header += String(x % 10) + " ";
  lines.push(C.dim + header + C.reset);
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    let row = `${C.dim}${String(y).padStart(2, " ")}${C.reset}  `;
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const cell = state.board[y * BOARD_SIZE + x];
      const hi = last.has(`${x},${y}`);
      if (cell === 0) row += `${hi ? C.blackHi : C.black}${hi ? "▣" : "●"} ${C.reset}`;
      else if (cell === 1) row += `${hi ? C.whiteHi : C.white}${hi ? "▣" : "○"} ${C.reset}`;
      else if (isStart(x, y)) row += `${C.star}✦ ${C.reset}`;
      else row += `${C.dim}· ${C.reset}`;
    }
    lines.push(row);
  }
  return lines.join("\n");
}

function fmtMove(move) {
  if (!move || move.kind === "pass") return "pass";
  return `${move.pieceId}@(${move.x},${move.y})#${move.orientationGlobalId}`;
}

async function runLiveGame(args) {
  const black = { difficulty: args.blackAi, modelPath: args.blackModel, timeLimitMs: args.teacherMs, label: "black" };
  const white = { difficulty: args.whiteAi, modelPath: args.whiteModel, timeLimitMs: args.teacherMs, label: "white" };
  let state = createInitialState(args.startPolicy);
  let moveNo = 0;
  console.log(`${C.bold}Self-play:${C.reset} Black=${args.blackAi}  White=${args.whiteAi}  start=${args.startPolicy}`);
  console.log(renderBoard(state));
  while (state.status === "playing" && moveNo < args.maxMoves) {
    const player = state.currentPlayer;
    const spec = player === 0 ? black : white;
    const decision = await decideTrainingMove(state, spec);
    const cells = decision.move.kind === "place" ? getCellsForMove(decision.move) : [];
    state = applyMove(state, decision.move);
    moveNo += 1;
    const [a, b] = scoreState(state);
    const s = decision.stats ?? {};
    const tag = player === 0 ? `${C.black} BLACK ${C.reset}` : `${C.white} WHITE ${C.reset}`;
    const detail = [
      s.value != null ? `v=${Number(s.value).toFixed(2)}` : null,
      s.simulations ? `sims=${s.simulations}` : null,
      s.engine ? s.engine : null,
    ].filter(Boolean).join(" ");
    console.log(`\n${C.bold}#${moveNo}${C.reset} ${tag} ${fmtMove(decision.move)}  ${C.dim}${detail}${C.reset}  score ${a} : ${b}`);
    console.log(renderBoard(state, cells));
    await sleep(args.delayMs);
  }
  const [a, b] = scoreState(state);
  const winner = a > b ? "Black ●" : b > a ? "White ○" : "Draw";
  console.log(`\n${C.green}${C.bold}Game over${C.reset} — moves=${moveNo}, score ${a} : ${b}, winner: ${C.bold}${winner}${C.reset}`);
}

function reconstructFromHistory(saved) {
  // Accepts the app's game JSON (with moveHistory[].move) or a list of moves.
  const moves = Array.isArray(saved) ? saved : (saved.moveHistory ?? []).map((r) => r.move ?? r);
  const startPolicy = saved.startPolicy ?? "fixedStart";
  return { moves, startPolicy };
}

async function runReplay(path) {
  const saved = JSON.parse(await readFile(path, "utf-8"));
  const { moves, startPolicy } = reconstructFromHistory(saved);
  let state = createInitialState(startPolicy);
  console.log(`${C.bold}Replay:${C.reset} ${path}  (${moves.length} moves)`);
  console.log(renderBoard(state));
  let n = 0;
  for (const move of moves) {
    const cells = move.kind === "place" ? getCellsForMove(move) : [];
    state = applyMove(state, move);
    n += 1;
    const [a, b] = scoreState(state);
    const tag = move.player === 0 ? `${C.black} BLACK ${C.reset}` : `${C.white} WHITE ${C.reset}`;
    console.log(`\n${C.bold}#${n}${C.reset} ${tag} ${fmtMove(move)}  score ${a} : ${b}`);
    console.log(renderBoard(state, cells));
  }
}

function sparkline(values) {
  const ticks = "▁▂▃▄▅▆▇█";
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v) => ticks[Math.min(7, Math.floor(((v - min) / span) * 7))]).join("");
}

async function runSummary(path) {
  const summary = JSON.parse(await readFile(path, "utf-8"));
  const arch = summary.model_arch ? `${summary.model_arch.channels}ch x ${summary.model_arch.residual_blocks}block${summary.model_arch.net_size ? ` (${summary.model_arch.net_size})` : ""}` : "n/a";
  console.log(`${C.bold}Training summary${C.reset}  device=${summary.device}  arch=${arch}  samples=${summary.samples}`);
  const history = summary.history ?? [];
  if (!history.length) return console.log("(no epoch history)");
  console.log(`${C.dim}epoch  train_loss   val_loss   val_acc   val_value_mae${C.reset}`);
  for (const h of history) {
    console.log(
      `${String(h.epoch).padStart(4)}   ${(h.train_loss ?? 0).toFixed(4).padStart(9)}  ${(h.val_loss ?? 0).toFixed(4).padStart(9)}  ` +
      `${((h.val_accuracy ?? 0) * 100).toFixed(1).padStart(6)}%  ${(h.val_value_mae ?? 0).toFixed(4).padStart(9)}`,
    );
  }
  console.log(`\nval_loss  ${sparkline(history.map((h) => h.val_loss ?? 0))}`);
  console.log(`val_acc   ${sparkline(history.map((h) => h.val_accuracy ?? 0))}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.summary) return runSummary(args.summary);
  if (args.replay) return runReplay(args.replay);
  return runLiveGame(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
