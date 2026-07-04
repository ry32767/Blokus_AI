import {
  BOARD_SIZE,
  EMPTY,
  PIECE_IDS,
  PLAYERS,
  START_POINTS,
  applyMove,
  createInitialState,
  explainPlacement,
  generateLegalMoves,
  getCellsForMove,
  getFlippedOrientation,
  getOrientations,
  getWinner,
  isLegalMove,
  scoreState,
} from "../../../packages/core/src/index.js";
import { decideFallbackMove, normalizeAiConfig } from "./ai/difficulty.js";

const app = document.querySelector("#app");
// v4: drop the persisted `simulations` cap that silently limited search effort.
const settingsKey = "blokus-ai-duo-settings-v4";
const resultAnnouncementDurationMs = 3600;

let gameState = createInitialState("chooseStart");
// Monotonic generation counter. Bumped whenever the game context changes out
// from under an in-flight AI think (new game, load, undo, mode change) so a
// stale worker decision is never applied to a different game.
let gameEpoch = 0;
let undoStack = [];
let selectedPieceId = "I1";
let selectedOrientationIndex = 0;
let hoverCell = null;
let paused = true;
let thinking = false;
let aiHalted = false;
let lastAiStats = null;
let resultAnnouncement = null;
let resultAnnouncementTimer = null;
let statusMessage = "Ready.";
let settings = loadSettings();
let worker = createAiWorker();

// All dynamic strings rendered through `app.innerHTML` must pass through this:
// loaded game JSON (piece ids, start assignment, move history) is
// user-controllable data.
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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
      { engine: "normal", maxThinkingMs: 900 },
      { engine: "normal", maxThinkingMs: 900 },
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

function setAiConfig(player, nextPartial) {
  settings.aiConfig[player] = normalizeAiConfig({
    ...settings.aiConfig[player],
    ...nextPartial,
  });
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

function clearResultAnnouncement() {
  if (resultAnnouncementTimer !== null) {
    clearTimeout(resultAnnouncementTimer);
    resultAnnouncementTimer = null;
  }
  resultAnnouncement = null;
}

function showResultAnnouncement(scores) {
  const winner = getWinner(gameState);
  resultAnnouncement = {
    headline: winner === null ? "Draw Game" : `${PLAYERS[winner].label} Wins`,
    detail: winner === null
      ? `${scores[0]} - ${scores[1]}`
      : `${PLAYERS[0].label} ${scores[0]}  |  ${PLAYERS[1].label} ${scores[1]}`,
  };

  if (resultAnnouncementTimer !== null) clearTimeout(resultAnnouncementTimer);
  resultAnnouncementTimer = setTimeout(() => {
    resultAnnouncementTimer = null;
    if (!resultAnnouncement) return;
    resultAnnouncement = null;
    render(false);
  }, resultAnnouncementDurationMs);
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
  clearResultAnnouncement();
  gameEpoch += 1;
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
    return false;
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
  if (gameState.status === "finished") {
    statusMessage = "Match complete.";
    showResultAnnouncement(scores);
  } else {
    clearResultAnnouncement();
    statusMessage = `${currentPlayerLabel()} to move.`;
  }
  render();
  return true;
}

function undo() {
  if (undoStack.length === 0 || thinking) return;
  clearResultAnnouncement();
  gameEpoch += 1;
  gameState = undoStack.pop();
  // In Human vs AI, keep popping until it is the human's turn again — otherwise
  // the AI immediately replays the move that was just undone.
  if (isHumanVsAiMode()) {
    while (undoStack.length > 0 && !isHumanTurn()) {
      gameState = undoStack.pop();
    }
  }
  hoverCell = null;
  if (!gameState.remainingPieces[gameState.currentPlayer].includes(selectedPieceId)) {
    selectedPieceId = gameState.remainingPieces[gameState.currentPlayer][0] || selectedPieceId;
    selectedOrientationIndex = 0;
  }
  statusMessage = "Undone.";
  render();
}

function rotateSelected(step = 1) {
  const count = currentOrientations().length;
  selectedOrientationIndex = (selectedOrientationIndex + step + count) % count;
  render();
}

function flipSelected() {
  const orientations = currentOrientations();
  const flipped = getFlippedOrientation(selectedOrientation());
  const flippedIndex = orientations.findIndex((orientation) => orientation.globalId === flipped?.globalId);
  if (flippedIndex >= 0) selectedOrientationIndex = flippedIndex;
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

// Structural validation for pasted game JSON. Without this, a hostile or
// corrupted payload becomes `gameState` verbatim and either breaks every
// subsequent render or injects markup through the innerHTML templates.
function validateLoadedState(state) {
  if (!state || typeof state !== "object") return "state must be an object";
  if (!Array.isArray(state.board) || state.board.length !== BOARD_SIZE * BOARD_SIZE) {
    return "board must have 196 cells";
  }
  if (!state.board.every((cell) => cell === EMPTY || cell === 0 || cell === 1)) {
    return "board contains invalid cell values";
  }
  if (state.currentPlayer !== 0 && state.currentPlayer !== 1) return "invalid currentPlayer";
  if (state.status !== "playing" && state.status !== "finished") return "invalid status";
  if (!Number.isInteger(state.turn) || state.turn < 0) return "invalid turn";
  const validPieceList = (pieces) => Array.isArray(pieces) && pieces.every((id) => PIECE_IDS.includes(id));
  for (const key of ["remainingPieces", "placedPieces"]) {
    if (!Array.isArray(state[key]) || state[key].length !== 2 || !state[key].every(validPieceList)) {
      return `invalid ${key}`;
    }
  }
  if (!Array.isArray(state.startAssignment) || state.startAssignment.length !== 2
    || !state.startAssignment.every((entry) => entry === null || entry === "A" || entry === "B")) {
    return "invalid startAssignment";
  }
  if (!Array.isArray(state.moveHistory)) return "invalid moveHistory";
  for (const record of state.moveHistory) {
    const move = record?.move;
    if (!move || (move.player !== 0 && move.player !== 1)) return "invalid moveHistory entry";
    if (move.kind !== "pass" && move.kind !== "place") return "invalid move kind in history";
    if (move.kind === "place") {
      if (!PIECE_IDS.includes(move.pieceId)) return "invalid piece in history";
      if (!Number.isInteger(move.x) || !Number.isInteger(move.y)
        || move.x < 0 || move.x >= BOARD_SIZE || move.y < 0 || move.y >= BOARD_SIZE) {
        return "invalid coordinates in history";
      }
    }
  }
  return null;
}

function loadGameJson() {
  const raw = window.prompt("Load Game JSON");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    const nextState = parsed.state || parsed;
    const problem = validateLoadedState(nextState);
    if (problem) {
      statusMessage = `Load failed: ${problem}.`;
      render();
      return;
    }
    gameEpoch += 1;
    gameState = nextState;
    if (parsed.settings && typeof parsed.settings === "object") {
      const loaded = parsed.settings;
      settings = {
        ...settings,
        ...(loaded.mode === "HUMAN_VS_HUMAN" || loaded.mode === "HUMAN_VS_AI" || loaded.mode === "AI_VS_AI"
          ? { mode: loaded.mode }
          : {}),
        ...(loaded.humanPlayer === 0 || loaded.humanPlayer === 1 ? { humanPlayer: loaded.humanPlayer } : {}),
        ...(loaded.startPolicy === "chooseStart" || loaded.startPolicy === "fixedStart"
          ? { startPolicy: loaded.startPolicy }
          : {}),
        ...(Number.isFinite(loaded.aiSpeed) ? { aiSpeed: loaded.aiSpeed } : {}),
        ...(Array.isArray(loaded.aiConfig) && loaded.aiConfig.length === 2
          ? { aiConfig: loaded.aiConfig.map((entry) => normalizeAiConfig(entry ?? {})) }
          : {}),
      };
    }
    undoStack = [];
    if (!gameState.remainingPieces[gameState.currentPlayer].includes(selectedPieceId)) {
      selectedPieceId = gameState.remainingPieces[gameState.currentPlayer][0] || "I1";
      selectedOrientationIndex = 0;
    }
    clearResultAnnouncement();
    statusMessage = "Game JSON loaded.";
  } catch {
    // Never echo parser output: JSON.parse error messages quote the raw input,
    // which would flow into innerHTML.
    statusMessage = "Load failed: invalid JSON.";
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

// `force` runs a single AI move even while paused (the Step button).
async function maybeStartAiTurn(force = false) {
  if (thinking || !(force || isAiTurn())) return;
  thinking = true;
  render(false);
  const epoch = gameEpoch;
  const aiState = structuredClone(gameState);
  const config = settings.aiConfig[aiState.currentPlayer];
  // A decision may only be applied to the exact game context it was computed
  // for: same game generation, same ply, and the AI is still expected to move
  // (guards against New Game / Load / Undo / mode changes mid-think).
  const decisionStillValid = () => epoch === gameEpoch
    && gameState.turn === aiState.turn
    && gameState.currentPlayer === aiState.currentPlayer
    && (force || isAiTurn());
  try {
    await new Promise((resolve) => setTimeout(resolve, Number(settings.aiSpeed)));
    const decision = await askWorker(aiState, config);
    if (decisionStillValid()) {
      lastAiStats = decision.stats;
      if (!applyGameMove(decision.move, decision.stats.thinkingMs, decision.stats)) {
        aiHalted = true;
        statusMessage = "AI halted: engine proposed an illegal move.";
      }
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
      if (decisionStillValid()) {
        lastAiStats = {
          ...fallbackDecision.stats,
          difficulty: config.difficulty ?? config.engine ?? fallbackDecision.stats.difficulty,
          engine: "fallback",
          strategy: "worker-timeout",
        };
        applyGameMove(fallbackDecision.move, fallbackDecision.stats.thinkingMs, lastAiStats);
        statusMessage = "AI used fallback after worker timeout.";
      }
      // Only a timeout indicates a stuck worker; recreate it. Other errors
      // (e.g. one engine failing on one position) keep the worker — and its
      // warmed ONNX sessions — alive.
      worker?.terminate();
      worker = createAiWorker();
    } else {
      statusMessage = `AI halted: ${error.message}`;
      aiHalted = true;
    }
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
        <button id="pass-top" ${!canPass || !isHumanTurn() ? "disabled" : ""}>Pass</button>
      </div>
      <div class="board-grid">${cells.join("")}</div>
      <p class="rule-message">${escapeHtml(previewResult?.reason || statusMessage)}</p>
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
        <span>Start ${escapeHtml(gameState.startAssignment[player] || "-")}</span>
      </div>
      <div class="piece-tray">
        ${allPieces.map((pieceId) => {
          const used = !remaining.has(pieceId);
          const selected = selectedPieceId === pieceId && gameState.currentPlayer === player;
          return `
            <button
              class="piece-button ${used ? "used" : ""} ${selected ? "selected" : ""}"
              data-piece="${escapeHtml(pieceId)}"
              data-player="${player}"
              ${used || player !== gameState.currentPlayer || !isHumanTurn() ? "disabled" : ""}
              aria-label="${escapeHtml(pieceId)}"
            >
              ${miniPieceSvg(pieceId)}
              <span>${escapeHtml(pieceId)}</span>
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
    ["expert_plus", "Expert+"],
    ["learned", "Learned"],
    ["master", "Master"],
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
    ["Exact", stats.exactSolved == null ? "-" : stats.exactSolved ? "yes" : "no"],
    ["Score Est", stats.finalScoreEstimate ?? "-"],
    ["Value", stats.value ?? "-"],
  ] : [];
  return `
    <section class="stats-panel">
      <h2>AI Stats</h2>
      ${stats ? `
        <dl>
          ${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
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
            : `${move.pieceId} at ${move.x + 1},${move.y + 1}`;
          return `<li><span>#${escapeHtml(record.ply)}</span><strong>${PLAYERS[move.player].label}</strong><span>${escapeHtml(body)}</span></li>`;
        }).join("") || `<li class="muted">No moves yet.</li>`}
      </ol>
    </section>
  `;
}

function renderResultOverlay() {
  if (gameState.status !== "finished" || !resultAnnouncement) return "";
  const { headline, detail } = resultAnnouncement;

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
        <span>Turn ${escapeHtml(gameState.turn)}</span>
        <strong>${thinking ? "AI thinking..." : escapeHtml(statusMessage)}</strong>
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
  document.querySelector("#flip-top")?.addEventListener("click", flipSelected);
  document.querySelector("#copy-json")?.addEventListener("click", copyGameJson);
  document.querySelector("#load-json")?.addEventListener("click", loadGameJson);
  document.querySelector("#toggle-ai")?.addEventListener("click", () => {
    paused = !paused;
    render();
  });
  document.querySelector("#step-ai")?.addEventListener("click", async () => {
    // Stay paused and force exactly one move: toggling `paused` around the
    // await let the render-queued maybeStartAiTurn() start a second think.
    await maybeStartAiTurn(true);
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
    gameEpoch += 1;
    paused = !isAiVsAiMode();
    lastAiStats = null;
    aiHalted = false;
    saveSettings();
    render();
  });
  document.querySelector("#human-player")?.addEventListener("change", (event) => {
    settings.humanPlayer = Number(event.target.value);
    gameEpoch += 1;
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
      setAiConfig(player, {
        engine: event.target.value,
        difficulty: event.target.value,
      });
      gameEpoch += 1;
      aiHalted = false;
      saveSettings();
      render();
    });
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") rotateSelected(1);
  if (event.key === "f" || event.key === "F") flipSelected();
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
