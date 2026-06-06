import { applyMove, generateLegalMoves, sameMove, scoreState } from "../../../../packages/core/src/index.js";
import { cheapMoveOrderScore, evaluateMoveQuick, evaluateState } from "./evaluation.js";
import { TranspositionTable, hashState } from "./transpositionTable.js";

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function timeExpired(startedAt, timeLimitMs) {
  return now() - startedAt >= timeLimitMs;
}

function orderMoves(state, player, table) {
  const moves = generateLegalMoves(state);
  const entry = table.get(hashState(state));
  return moves
    .map((move) => ({
      move,
      priority: entry?.bestMove && sameMove(entry.bestMove, move) ? Number.POSITIVE_INFINITY : cheapMoveOrderScore(move),
    }))
    .sort((a, b) => b.priority - a.priority)
    .map((item) => item.move);
}

function alphaBetaSearch(state, depth, alpha, beta, rootPlayer, startedAt, timeLimitMs, table, counters) {
  if (timeExpired(startedAt, timeLimitMs)) {
    throw new Error("TIME_LIMIT");
  }

  const hash = hashState(state);
  const cached = table.get(hash);
  if (cached && cached.depth >= depth) {
    counters.tableHits += 1;
    if (cached.bound === "exact") return { value: cached.value, bestMove: cached.bestMove };
    if (cached.bound === "lower") alpha = Math.max(alpha, cached.value);
    if (cached.bound === "upper") beta = Math.min(beta, cached.value);
    if (alpha >= beta) return { value: cached.value, bestMove: cached.bestMove };
  }

  if (depth === 0 || state.status !== "playing") {
    return { value: evaluateState(state, rootPlayer), bestMove: null };
  }

  const moves = orderMoves(state, state.currentPlayer, table);
  let bestMove = moves[0] ?? null;
  const maximizing = state.currentPlayer === rootPlayer;
  let bestValue = maximizing ? -Infinity : Infinity;
  const originalAlpha = alpha;
  const originalBeta = beta;

  for (const move of moves) {
    counters.nodes += 1;
    const nextState = applyMove(state, move);
    const result = alphaBetaSearch(nextState, depth - 1, alpha, beta, rootPlayer, startedAt, timeLimitMs, table, counters);
    const value = result.value;

    if (maximizing) {
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
      alpha = Math.max(alpha, value);
    } else {
      if (value < bestValue) {
        bestValue = value;
        bestMove = move;
      }
      beta = Math.min(beta, value);
    }

    if (alpha >= beta) break;
  }

  let bound = "exact";
  if (bestValue <= originalAlpha) bound = "upper";
  else if (bestValue >= originalBeta) bound = "lower";

  table.set({
    hash,
    depth,
    value: bestValue,
    bound,
    bestMove,
  });

  return { value: bestValue, bestMove };
}

export async function chooseEndgameAlphaBetaMove(state, config = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 1500;
  const maxDepth = config.maxDepth ?? 5;
  const table = config.table ?? new TranspositionTable();
  const counters = { nodes: 0, tableHits: 0 };

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: config.difficulty ?? "expert",
        engine: "alpha_beta",
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: -1,
        depth: 0,
        nodes: 1,
        tableHits: 0,
      },
    };
  }

  let bestMove = legalMoves[0];
  let bestValue = -Infinity;
  let completedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      const result = alphaBetaSearch(
        state,
        depth,
        -Infinity,
        Infinity,
        state.currentPlayer,
        startedAt,
        timeLimitMs,
        table,
        counters,
      );
      if (result.bestMove) {
        bestMove = result.bestMove;
        bestValue = result.value;
      }
      completedDepth = depth;
    } catch (error) {
      if (error.message !== "TIME_LIMIT") {
        throw error;
      }
      break;
    }
  }

  return {
    move: bestMove,
    stats: {
      difficulty: config.difficulty ?? "expert",
      engine: "alpha_beta",
      thinkingMs: Math.round(now() - startedAt),
      legalMoves: legalMoves.length,
      selectedAction: -1,
      selectedPieceId: bestMove.kind === "place" ? bestMove.pieceId : undefined,
      depth: completedDepth,
      nodes: counters.nodes,
      tableHits: counters.tableHits,
      value: Number(bestValue.toFixed(2)),
    },
  };
}

function finalScoreValue(state, rootPlayer) {
  const [scoreA, scoreB] = scoreState(state);
  return rootPlayer === 0 ? scoreA - scoreB : scoreB - scoreA;
}

function exactSearch(state, alpha, beta, rootPlayer, startedAt, timeLimitMs, table, counters) {
  if (timeExpired(startedAt, timeLimitMs)) {
    throw new Error("TIME_LIMIT");
  }

  const hash = hashState(state);
  const cached = table.get(hash);
  if (cached && cached.exactSolved) {
    counters.tableHits += 1;
    return { value: cached.value, bestMove: cached.bestMove ?? null };
  }

  if (state.status !== "playing") {
    return { value: finalScoreValue(state, rootPlayer), bestMove: null };
  }

  const moves = orderMoves(state, state.currentPlayer, table);
  const maximizing = state.currentPlayer === rootPlayer;
  let bestMove = moves[0] ?? null;
  let bestValue = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    counters.nodes += 1;
    const nextState = applyMove(state, move);
    const result = exactSearch(nextState, alpha, beta, rootPlayer, startedAt, timeLimitMs, table, counters);
    const value = result.value;

    if (maximizing) {
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
      }
      alpha = Math.max(alpha, value);
    } else {
      if (value < bestValue) {
        bestValue = value;
        bestMove = move;
      }
      beta = Math.min(beta, value);
    }

    if (alpha >= beta) break;
  }

  table.set({
    hash,
    depth: Number.MAX_SAFE_INTEGER,
    value: bestValue,
    bound: "exact",
    bestMove,
    exactSolved: true,
  });

  return { value: bestValue, bestMove };
}

export async function chooseExactEndgameMove(state, config = {}) {
  const startedAt = now();
  const legalMoves = generateLegalMoves(state);
  const timeLimitMs = config.timeLimitMs ?? config.maxThinkingMs ?? 5000;
  const table = config.table ?? new TranspositionTable();
  const counters = { nodes: 0, tableHits: 0 };

  if (legalMoves.length === 1 && legalMoves[0].kind === "pass") {
    return {
      move: legalMoves[0],
      stats: {
        difficulty: config.difficulty ?? "expert_plus",
        engine: "exact_solver",
        strategy: "exact",
        exactSolved: true,
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: 1,
        selectedAction: -1,
        depth: "full",
        nodes: 1,
        tableHits: 0,
        finalScoreEstimate: 0,
      },
    };
  }

  try {
    const result = exactSearch(
      state,
      -Infinity,
      Infinity,
      state.currentPlayer,
      startedAt,
      timeLimitMs,
      table,
      counters,
    );

    return {
      move: result.bestMove ?? legalMoves[0],
      stats: {
        difficulty: config.difficulty ?? "expert_plus",
        engine: "exact_solver",
        strategy: "exact",
        exactSolved: true,
        thinkingMs: Math.round(now() - startedAt),
        legalMoves: legalMoves.length,
        selectedAction: -1,
        selectedPieceId: result.bestMove?.kind === "place" ? result.bestMove.pieceId : undefined,
        depth: "full",
        nodes: counters.nodes,
        tableHits: counters.tableHits,
        value: Number(result.value.toFixed(2)),
        finalScoreEstimate: Number(result.value.toFixed(2)),
      },
    };
  } catch (error) {
    if (error.message !== "TIME_LIMIT") {
      throw error;
    }

    const fallback = await chooseEndgameAlphaBetaMove(state, {
      ...config,
      difficulty: config.difficulty ?? "expert_plus",
      timeLimitMs: Math.max(400, Math.floor(timeLimitMs / 3)),
      maxDepth: config.maxDepth ?? 8,
      table,
    });

    return {
      ...fallback,
      stats: {
        ...fallback.stats,
        engine: "exact_solver",
        strategy: "exact_timeout_fallback",
        exactSolved: false,
      },
    };
  }
}
