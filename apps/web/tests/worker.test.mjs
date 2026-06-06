import assert from "node:assert/strict";
import { createSuite } from "../../../tests/testHarness.mjs";
import { applyMove, createInitialState, generateLegalMoves } from "../../../packages/core/src/index.js";
import { handleAiWorkerRequest } from "../src/workers/aiWorkerCore.js";

const suite = createSuite("worker-protocol");

function createReducedBranchState() {
  let state = createInitialState("fixedStart");
  for (let i = 0; i < 6; i += 1) {
    const move = generateLegalMoves(state)[0];
    state = applyMove(state, move);
  }
  return state;
}

suite.test("INIT returns READY", async () => {
  const response = await handleAiWorkerRequest({ type: "INIT" });
  assert.deepEqual(response, { type: "READY" });
});

suite.test("CANCEL returns no message", async () => {
  const response = await handleAiWorkerRequest({ type: "CANCEL", requestId: "cancel-1" });
  assert.equal(response, null);
});

suite.test("THINK returns a legal decision", async () => {
  const state = createReducedBranchState();
  const response = await handleAiWorkerRequest({
    type: "THINK",
    requestId: "think-1",
    state,
    config: { difficulty: "normal", timeLimitMs: 120, simulations: 4, maxChildren: 8, candidateLimit: 8 },
  });

  assert.equal(response.type, "DECISION");
  assert.equal(response.requestId, "think-1");
  assert.ok(response.decision);
});

suite.test("illegal engine output falls back to a legal move", async () => {
  const state = createInitialState("fixedStart");
  const legalFallback = generateLegalMoves(state)[0];

  const response = await handleAiWorkerRequest(
    {
      type: "THINK",
      requestId: "think-2",
      state,
      config: { difficulty: "expert", timeLimitMs: 120 },
    },
    {
      decideMove: async () => ({
        move: { kind: "pass", player: state.currentPlayer },
        stats: { engine: "broken", thinkingMs: 1, legalMoves: 1, selectedAction: -1 },
      }),
      decideFallbackMove: async () => ({
        move: legalFallback,
        stats: { engine: "heuristic", thinkingMs: 1, legalMoves: 1, selectedAction: -1 },
      }),
      isLegalMove: (candidateState, move) => move.kind === legalFallback.kind && move.pieceId === legalFallback.pieceId,
    },
  );

  assert.equal(response.type, "DECISION");
  assert.deepEqual(response.decision.move, legalFallback);
});

export default suite;
