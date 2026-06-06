import {
  BOARD_SIZE,
  EMPTY,
  PLAYERS,
  START_POINTS,
  applyMove,
  createInitialState,
  explainPlacement,
  generateLegalMoves,
  getCellsForMove,
  getOrientations,
  getWinner,
  isLegalMove,
  scoreState,
} from "../../../packages/core/src/index.js";
import { decideFallbackMove, normalizeAiConfig } from "./ai/difficulty.js";

const app = document.querySelector("#app");
const settingsKey = "blokus-ai-duo-settings-v1";

let gameState = createInitialState("chooseStart");
let undoStack = [];
let selectedPieceId = "I1";
let selectedOrientationIndex = 0;
let hoverCell = null;
let paused = true;
let thinking = false;
let aiHalted = false;
let lastAiStats = null;
let statusMessage = "Ready.";
let settings = loadSettings();
let worker = createAiWorker();

function isHumanVsHumanMode() {
  return settings.mode === "HUMAN_VS_HUMAN";
}

function isHumanVsAiMode() {
  return settings.mode === "HUMAN_VS_AI";
}

function isAiVsAiMode() {
  return settings.mode === "AI_VS_AI";
}

function loadSettings() {
  const defaults = {
    mode: "HUMAN_VS_AI",
    humanPlayer: 0,
    startPolicy: "chooseStart",
    aiConfig: [
      { engine: "normal", maxThinkingMs: 900, simulations: 96 },
      { engine: "normal", maxThinkingMs: 900, simulations: 96 },
    ],
    aiSpeed: 500,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    const merged = { ...defaults, ...saved, aiConfig: saved?.aiConfig || defaults.aiConfig };
    return {
      ...merged,
      aiConfig: merged.aiConfig.map((entry, index) => ({
        ...normalizeAiConfig({
          ...defaults.aiConfig[index],
          ...entry,
        }),
      })),
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

function createAiWorker() {
  try {
    const nextWorker = new Worker(new URL("./workers/aiWorker.js", import.meta.url), {
      type: "module",
    });
    nextWorker.postMessage({ type: "INIT" });
    return nextWorker;
  } catch {
    return null;
  }
}

function currentPlayerLabel() {
  return PLAYERS[gameState.currentPlayer].label;
}

function currentOrientations() {
  return getOrientations(selectedPieceId);
}

function selectedOrientation() {
  const orientations = currentOrientations();
  return orientations[selectedOrientationIndex % orientations.length];
}

function currentPreviewMove(cell = hoverCell) {
  if (!cell || !selectedPieceId) return null;
  const orientation = selectedOrientation();
  return {
    kind: "place",
    player: gameState.currentPlayer,
    pieceId: selectedPieceId,
    orientationGlobalId: orientation.globalId,
    x: cell.x,
    y: cell.y,
  };
}

function currentPreviewOrigin() {
  if (!hoverCell || !selectedPieceId || !isHumanTurn() || gameState.status !== "playing") {
    return null;
  }
  return `${hoverCell.x},${hoverCell.y}`;
}

function currentLegalTargets() {
  if (!isHumanTurn() || gameState.status !== "playing" || !selectedPieceId) {
    return new Set();
  }

  const targets = new Set();
  const orientation = selectedOrientation();

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const move = {
        kind: "place",
        player: gameState.currentPlayer,
        pieceId: selectedPieceId,
        orientationGlobalId: orientation.globalId,
        x,
        y,
      };
      if (explainPlacement(gameState, move).legal) {
        targets.add(`${x},${y}`);
      }
    }
  }

  return targets;
}

function isHumanTurn() {
  if (gameState.status !== "playing") return false;
  if (isHumanVsHumanMode()) return true;
  if (isAiVsAiMode()) return false;
  return gameState.currentPlayer === Number(settings.humanPlayer);
}

function isAiTurn() {
  if (gameState.status !== "playing") return false;
  if (aiHalted) return false;
  if (isHumanVsHumanMode()) return false;
  if (isAiVsAiMode()) return !paused;
  return !isHumanTurn();
}

function resetGame() {
  gameState = createInitialState(settings.startPolicy);
  undoStack = [];
  selectedPieceId = "I1";
  selectedOrientationIndex = 0;
  hoverCell = null;
  lastAiStats = null;
  statusMessage = "New game started.";
  paused = !isAiVsAiMode();
  aiHalted = false;
  render();
}

function applyGameMove(move, thinkingMs, aiStats) {
  if (!isLegalMove(gameState, move)) {
    statusMessage = "Illegal move rejected.";
    render();
    return;
  }
  undoStack.push(structuredClone(gameState));
  gameState = applyMove(gameState, move);
  if (aiStats) {
    const last = gameState.moveHistory.at(-1);
    last.thinkingMs = thinkingMs;
    last.aiStats = aiStats;
  }
  aiHalted = false;
  hoverCell = null;
  selectedPieceId = gameState.remainingPieces[gameState.currentPlayer][0] || selectedPieceId;
  selectedOrientationIndex = 0;
  const scores = scoreState(gameState);
  statusMessage =
    gameState.status === "finished"
      ? formatFinishedMessage(scores)
      : `${currentPlayerLabel()} to move.`;
  render();
}

function formatFinishedMessage(scores) {
  const winner = getWinner(gameState);
  if (winner === null) return `Finished. Draw ${scores[0]}-${scores[1]}.`;
  return `Finished. ${PLAYERS[winner].label} wins ${scores[0]}-${scores[1]}.`;
}

function undo() {
  if (undoStack.length === 0 || thinking) return;
  gameState = undoStack.pop();
  statusMessage = "Undone.";
  render();
}

function skipTurn() {
  if (!isHumanTurn() || gameState.status !== "playing" || thinking) return;
  const skippedPlayer = gameState.currentPlayer;
  undoStack.push(structuredClone(gameState));
  gameState = {
    ...gameState,
    currentPlayer: skippedPlayer === 0 ? 1 : 0,
    turn: gameState.turn + 1,
    moveHistory: gameState.moveHistory.concat({
      ply: gameState.turn + 1,
      move: { kind: "skip", player: skippedPlayer },
    }),
  };
  hoverCell = null;
  selectedPieceId = gameState.remainingPieces[gameState.currentPlayer][0] || selectedPieceId;
  selectedOrientationIndex = 0;
  statusMessage = `${PLAYERS[skippedPlayer].label} skipped. ${currentPlayerLabel()} to move.`;
  render();
}

function rotateSelected(step = 1) {
  const count = currentOrientations().length;
  selectedOrientationIndex = (selectedOrientationIndex + step + count) % count;
  render();
}

function selectPiece(pieceId) {
  if (!isHumanTurn()) return;
  if (!gameState.remainingPieces[gameState.currentPlayer].includes(pieceId)) return;
  selectedPieceId = pieceId;
  selectedOrientationIndex = 0;
  render();
}

function handleBoardClick(x, y) {
  if (!isHumanTurn()) return;
  const move = currentPreviewMove({ x, y });
  if (!move) return;
  const result = explainPlacement(gameState, move);
  statusMessage = result.reason;
  if (result.legal) applyGameMove(move);
  else render();
}

async function copyGameJson() {
  const payload = JSON.stringify({ state: gameState, settings }, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    statusMessage = "Game JSON copied.";
  } catch {
    window.prompt("Copy Game JSON", payload);
    statusMessage = "Game JSON opened.";
  }
  render();
}

function loadGameJson() {
  const raw = window.prompt("Load Game JSON");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    gameState = parsed.state || parsed;
    if (parsed.settings) settings = { ...settings, ...parsed.settings };
    undoStack = [];
    statusMessage = "Game JSON loaded.";
  } catch (error) {
    statusMessage = `Load failed: ${error.message}`;
  }
  render();
}

function askWorker(state, config) {
  if (!worker) return decideFallbackMove(state, config);
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const requestedBudget = config.timeLimitMs ?? config.maxThinkingMs ?? 1000;
    const timeout = setTimeout(() => {
      worker.removeEventListener("message", onMessage);
      reject(new Error("AI worker timed out."));
    }, Math.max(4000, requestedBudget * 5));

    function onMessage(event) {
      const response = event.data;
      if (response.requestId !== requestId) return;
      clearTimeout(timeout);
      worker.removeEventListener("message", onMessage);
      if (response.type === "ERROR") reject(new Error(response.message));
      else resolve(response.decision);
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage({ type: "THINK", requestId, state, config });
  });
}

async function maybeStartAiTurn() {
  if (thinking || !isAiTurn()) return;
  thinking = true;
  render(false);
  const aiState = structuredClone(gameState);
  const config = settings.aiConfig[aiState.currentPlayer];
  try {
    await new Promise((resolve) => setTimeout(resolve, Number(settings.aiSpeed)));
    const decision = await askWorker(aiState, config);
    if (gameState.turn === aiState.turn && gameState.currentPlayer === aiState.currentPlayer) {
      lastAiStats = decision.stats;
      applyGameMove(decision.move, decision.stats.thinkingMs, decision.stats);
    }
  } catch (error) {
    if ((error.message || "").includes("timed out")) {
      const fallbackDecision = await decideFallbackMove(aiState, {
        ...config,
        difficulty: "normal",
        timeLimitMs: 250,
        maxThinkingMs: 250,
        shortlistLimit: 10,
      });
      if (gameState.turn === aiState.turn && gameState.currentPlayer === aiState.currentPlayer) {
        lastAiStats = {
          ...fallbackDecision.stats,
          difficulty: config.difficulty ?? config.engine ?? fallbackDecision.stats.difficulty,
          engine: "fallback",
          strategy: "worker-timeout",
        };
        applyGameMove(fallbackDecision.move, fallbackDecision.stats.thinkingMs, lastAiStats);
        statusMessage = "AI used fallback after worker timeout.";
      }
    } else {
      statusMessage = `AI halted: ${error.message}`;
      aiHalted = true;
    }
    worker?.terminate();
    worker = createAiWorker();
  } finally {
    thinking = false;
    render();
  }
}

function miniPieceSvg(pieceId, orientationIndex = 0) {
  const orientation = getOrientations(pieceId)[orientationIndex] || getOrientations(pieceId)[0];
  const size = 12;
  const width = orientation.width * size;
  const height = orientation.height * size;
  const rects = orientation.cells
    .map(([x, y]) => `<rect x="${x * size + 1}" y="${y * size + 1}" width="${size - 2}" height="${size - 2}" rx="2"></rect>`)
    .join("");
  return `<svg class="piece-icon" viewBox="0 0 ${width} ${height}" aria-hidden="true">${rects}</svg>`;
}

function renderBoard() {
  const preview = currentPreviewMove();
  const previewCells = preview ? getCellsForMove(preview) : [];
  const previewResult = preview ? explainPlacement(gameState, preview) : null;
  const legalTargets = currentLegalTargets();
  const previewOrigin = currentPreviewOrigin();
  const lastMove = gameState.moveHistory.at(-1)?.move;
  const lastCells = lastMove?.kind === "place" ? getCellsForMove(lastMove) : [];
  const legalMoves = generateLegalMoves(gameState);
  const canPass = legalMoves.length === 1 && legalMoves[0].kind === "pass";
  const cells = [];

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const value = gameState.board[y * BOARD_SIZE + x];
      const isStart = (START_POINTS.A.x === x && START_POINTS.A.y === y) || (START_POINTS.B.x === x && START_POINTS.B.y === y);
      const isLegalTarget = value === EMPTY && legalTargets.has(`${x},${y}`);
      const isPreview = previewCells.some((cell) => cell.x === x && cell.y === y);
      const isPreviewOrigin = previewOrigin === `${x},${y}`;
      const isLast = lastCells.some((cell) => cell.x === x && cell.y === y);
      const classes = [
        "board-cell",
        value === 0 ? "player-0" : "",
        value === 1 ? "player-1" : "",
        isStart ? "start-point" : "",
        isLegalTarget ? "legal-target" : "",
        isPreviewOrigin ? "preview-origin" : "",
        isPreview ? (previewResult?.legal ? "preview-legal" : "preview-illegal") : "",
        isLast ? "last-move" : "",
      ].filter(Boolean).join(" ");
      cells.push(
        `<button class="${classes}" data-board="${x},${y}" aria-label="Cell ${x + 1}, ${y + 1}" ${!isHumanTurn() ? "disabled" : ""}></button>`,
      );
    }
  }

  return `
    <section class="board-panel" aria-label="Game board">
      <div class="board-meta">
        <span>${currentPlayerLabel()} turn</span>
        <span>${legalMoves.length} legal ${canPass ? "pass" : "moves"}</span>
      </div>
      <div class="board-actions">
        <button id="rotate-top" ${!isHumanTurn() ? "disabled" : ""}>Rotate</button>
        <button id="flip-top" ${!isHumanTurn() ? "disabled" : ""}>Flip</button>
        <button id="skip-turn" ${!isHumanTurn() || thinking ? "disabled" : ""}>Skip</button>
        <button id="pass-top" ${!canPass || !isHumanTurn() ? "disabled" : ""}>Pass</button>
      </div>
      <div class="board-grid">${cells.join("")}</div>
      <p class="rule-message">${previewResult?.reason || statusMessage}</p>
      <p class="guide-message">Green dots show every place this piece can legally start. Hovering a cell shows the full footprint from that position.</p>
    </section>
  `;
}

function renderTray(player) {
  const remaining = new Set(gameState.remainingPieces[player]);
  const pieces = gameState.placedPieces[player].concat(gameState.remainingPieces[player]);
  const uniquePieces = Array.from(new Set(pieces.length ? pieces : gameState.remainingPieces[player]));
  const allPieces = uniquePieces.length ? uniquePieces : [];
  const score = scoreState(gameState)[player];
  const isActive = gameState.currentPlayer === player && gameState.status === "playing";

  return `
    <aside class="player-panel ${isActive ? "active-player" : ""}">
      <div class="player-title">
        <span class="player-chip player-${player}"></span>
        <h2>${PLAYERS[player].label}</h2>
        <strong>${score}</strong>
      </div>
      <div class="player-subline">
        <span>${gameState.remainingPieces[player].length} pieces left</span>
        <span>Start ${gameState.startAssignment[player] || "-"}</span>
      </div>
      <div class="piece-tray">
        ${allPieces.map((pieceId) => {
          const used = !remaining.has(pieceId);
          const selected = selectedPieceId === pieceId && gameState.currentPlayer === player;
          return `
            <button
              class="piece-button ${used ? "used" : ""} ${selected ? "selected" : ""}"
              data-piece="${pieceId}"
              data-player="${player}"
              ${used || player !== gameState.currentPlayer || !isHumanTurn() ? "disabled" : ""}
              aria-label="${pieceId}"
            >
              ${miniPieceSvg(pieceId)}
              <span>${pieceId}</span>
            </button>
          `;
        }).join("")}
      </div>
    </aside>
  `;
}

function renderControls() {
  const legalMoves = generateLegalMoves(gameState);
  const passMove = legalMoves.length === 1 && legalMoves[0].kind === "pass" ? legalMoves[0] : null;
  const scores = scoreState(gameState);

  return `
    <section class="controls-panel">
      <div class="control-row">
        <label>
          Mode
          <select id="mode">
            <option value="HUMAN_VS_HUMAN" ${settings.mode === "HUMAN_VS_HUMAN" ? "selected" : ""}>Human vs Human</option>
            <option value="HUMAN_VS_AI" ${settings.mode === "HUMAN_VS_AI" ? "selected" : ""}>Human vs AI</option>
            <option value="AI_VS_AI" ${settings.mode === "AI_VS_AI" ? "selected" : ""}>AI vs AI</option>
          </select>
        </label>
        <label>
          Human
          <select id="human-player" ${!isHumanVsAiMode() ? "disabled" : ""}>
            <option value="0" ${Number(settings.humanPlayer) === 0 ? "selected" : ""}>Black</option>
            <option value="1" ${Number(settings.humanPlayer) === 1 ? "selected" : ""}>White</option>
          </select>
        </label>
        <label>
          Start
          <select id="start-policy">
            <option value="chooseStart" ${settings.startPolicy === "chooseStart" ? "selected" : ""}>Choose</option>
            <option value="fixedStart" ${settings.startPolicy === "fixedStart" ? "selected" : ""}>Fixed</option>
          </select>
        </label>
      </div>
      <div class="control-row">
        <label>
          Black AI
          <select data-ai-engine="0" ${isHumanVsHumanMode() ? "disabled" : ""}>
            ${engineOptions(settings.aiConfig[0].engine)}
          </select>
        </label>
        <label>
          White AI
          <select data-ai-engine="1" ${isHumanVsHumanMode() ? "disabled" : ""}>
            ${engineOptions(settings.aiConfig[1].engine)}
          </select>
        </label>
        <label>
          Speed
          <input id="ai-speed" type="range" min="0" max="1500" step="100" value="${settings.aiSpeed}" ${isHumanVsHumanMode() ? "disabled" : ""} />
        </label>
      </div>
      <div class="button-row">
        <button id="new-game">New Game</button>
        <button id="undo" ${undoStack.length === 0 || thinking ? "disabled" : ""}>Undo</button>
        <button id="toggle-ai" ${!isAiVsAiMode() || gameState.status !== "playing" ? "disabled" : ""}>${paused ? "Run" : "Pause"}</button>
        <button id="step-ai" ${!isAiVsAiMode() || gameState.status !== "playing" || thinking ? "disabled" : ""}>Step</button>
        <button id="retry-ai" ${isHumanVsHumanMode() || gameState.status !== "playing" || thinking || !aiHalted ? "disabled" : ""}>Retry AI</button>
      </div>
      <div class="button-row secondary">
        <button id="copy-json">Copy Game JSON</button>
        <button id="load-json">Load Game JSON</button>
      </div>
      <div class="score-strip">
        <span>Black ${scores[0]}</span>
        <span>White ${scores[1]}</span>
      </div>
    </section>
  `;
}

function engineOptions(selected) {
  return [
    ["easy", "Easy"],
    ["normal", "Normal"],
    ["hard", "Hard"],
    ["expert", "Expert"],
  ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function renderStats() {
  const stats = lastAiStats;
  const emptyMessage = isHumanVsHumanMode() ? "Human vs Human mode: AI stats are idle." : "No AI move yet.";
  const entries = stats ? [
    ["Difficulty", stats.difficulty ?? "-"],
    ["Engine", stats.engine ?? "-"],
    ["Strategy", stats.strategy ?? stats.fallback ?? "-"],
    ["Time", stats.thinkingMs != null ? `${stats.thinkingMs} ms` : "-"],
    ["Legal", stats.legalMoves ?? "-"],
    ["Piece", stats.selectedPieceId || (stats.moveKind === "pass" ? "pass" : "-")],
    ["Depth", stats.depth ?? "-"],
    ["Beam", stats.beamWidth ?? "-"],
    ["Nodes", stats.nodes ?? "-"],
    ["Sims", stats.simulations ?? "-"],
    ["TT Hits", stats.tableHits ?? "-"],
    ["Value", stats.value ?? "-"],
  ] : [];
  return `
    <section class="stats-panel">
      <h2>AI Stats</h2>
      ${stats ? `
        <dl>
          ${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
        </dl>
      ` : `<p class="muted">${emptyMessage}</p>`}
    </section>
  `;
}

function renderLog() {
  const records = gameState.moveHistory.slice(-12).reverse();
  return `
    <section class="log-panel">
      <h2>Game Log</h2>
      <ol>
        ${records.map((record) => {
          const move = record.move;
          const body = move.kind === "pass"
            ? "pass"
            : move.kind === "skip"
              ? "skip"
              : `${move.pieceId} at ${move.x + 1},${move.y + 1}`;
          return `<li><span>#${record.ply}</span><strong>${PLAYERS[move.player].label}</strong><span>${body}</span></li>`;
        }).join("") || `<li class="muted">No moves yet.</li>`}
      </ol>
    </section>
  `;
}

function renderResultOverlay() {
  if (gameState.status !== "finished") return "";
  const scores = scoreState(gameState);
  const winner = getWinner(gameState);
  const headline = winner === null ? "Draw Game" : `${PLAYERS[winner].label} Wins`;
  const detail = winner === null
    ? `${scores[0]} - ${scores[1]}`
    : `${PLAYERS[0].label} ${scores[0]}  |  ${PLAYERS[1].label} ${scores[1]}`;

  return `
    <div class="result-overlay" role="status" aria-live="polite">
      <div class="result-burst" aria-hidden="true"></div>
      <div class="result-card">
        <p class="result-kicker">Match Complete</p>
        <h2>${headline}</h2>
        <p class="result-score">${detail}</p>
      </div>
    </div>
  `;
}

function render(allowAi = true) {
  const finished = gameState.status === "finished";
  app.innerHTML = `
    <header class="app-header">
      <div>
        <p class="eyebrow">Static GitHub Pages app</p>
        <h1>BlokusAI Duo</h1>
      </div>
      <div class="status-card ${finished ? "finished" : ""}">
        <span>Turn ${gameState.turn}</span>
        <strong>${thinking ? "AI thinking..." : statusMessage}</strong>
      </div>
    </header>
    <main class="app-shell">
      ${renderTray(0)}
      ${renderBoard()}
      ${renderTray(1)}
      <div class="bottom-grid">
        ${renderControls()}
        ${renderStats()}
        ${renderLog()}
      </div>
    </main>
    ${renderResultOverlay()}
  `;
  bindEvents();
  if (allowAi) queueMicrotask(maybeStartAiTurn);
}

function bindEvents() {
  for (const button of document.querySelectorAll("[data-board]")) {
    const [x, y] = button.dataset.board.split(",").map(Number);
    button.addEventListener("mouseenter", () => {
      hoverCell = { x, y };
      render(false);
    });
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handleBoardClick(x, y);
    });
  }

  document.querySelectorAll("[data-piece]").forEach((button) => {
    button.addEventListener("click", () => selectPiece(button.dataset.piece));
  });

  document.querySelector("#new-game")?.addEventListener("click", resetGame);
  document.querySelector("#undo")?.addEventListener("click", undo);
  document.querySelector("#rotate-top")?.addEventListener("click", () => rotateSelected(1));
  document.querySelector("#flip-top")?.addEventListener("click", () => rotateSelected(-1));
  document.querySelector("#skip-turn")?.addEventListener("click", skipTurn);
  document.querySelector("#copy-json")?.addEventListener("click", copyGameJson);
  document.querySelector("#load-json")?.addEventListener("click", loadGameJson);
  document.querySelector("#toggle-ai")?.addEventListener("click", () => {
    paused = !paused;
    render();
  });
  document.querySelector("#step-ai")?.addEventListener("click", async () => {
    paused = false;
    await maybeStartAiTurn();
    paused = true;
    render();
  });
  document.querySelector("#retry-ai")?.addEventListener("click", () => {
    aiHalted = false;
    statusMessage = "AI resumed.";
    render();
  });
  document.querySelector("#pass-top")?.addEventListener("click", () => {
    const legalMoves = generateLegalMoves(gameState);
    if (legalMoves.length === 1 && legalMoves[0].kind === "pass") applyGameMove(legalMoves[0]);
  });

  document.querySelector("#mode")?.addEventListener("change", (event) => {
    settings.mode = event.target.value;
    paused = !isAiVsAiMode();
    lastAiStats = null;
    aiHalted = false;
    saveSettings();
    render();
  });
  document.querySelector("#human-player")?.addEventListener("change", (event) => {
    settings.humanPlayer = Number(event.target.value);
    aiHalted = false;
    saveSettings();
    render();
  });
  document.querySelector("#start-policy")?.addEventListener("change", (event) => {
    settings.startPolicy = event.target.value;
    saveSettings();
    resetGame();
  });
  document.querySelector("#ai-speed")?.addEventListener("input", (event) => {
    settings.aiSpeed = Number(event.target.value);
    saveSettings();
  });
  document.querySelectorAll("[data-ai-engine]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const player = Number(select.dataset.aiEngine);
      settings.aiConfig[player].engine = event.target.value;
      aiHalted = false;
      saveSettings();
      render();
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") rotateSelected(1);
  if (event.key === "f" || event.key === "F") rotateSelected(-1);
  if (event.key === "Escape") {
    hoverCell = null;
    statusMessage = "Selection cleared.";
    render();
  }
  if (event.key === "Enter") {
    const move = currentPreviewMove();
    if (move && isHumanTurn() && explainPlacement(gameState, move).legal) applyGameMove(move);
  }
  if (event.code === "Space" && isAiVsAiMode()) {
    event.preventDefault();
    paused = !paused;
    render();
  }
});

resetGame();
