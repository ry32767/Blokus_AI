import { isLegalMove } from "../../../../packages/core/src/index.js";
import { decideHeuristic } from "../ai/engines.js";
import { decideDifficultyMove } from "../ai/difficulty.js";

export async function handleAiWorkerRequest(
  request,
  dependencies = {
    decideMove: decideDifficultyMove,
    decideFallbackMove: decideHeuristic,
    isLegalMove,
  },
) {
  if (request.type === "INIT") {
    return { type: "READY" };
  }

  if (request.type === "CANCEL") {
    return null;
  }

  if (request.type !== "THINK") {
    return null;
  }

  let decision = await dependencies.decideMove(request.state, request.config);
  if (!dependencies.isLegalMove(request.state, decision.move)) {
    decision = await dependencies.decideFallbackMove(request.state, request.config);
  }

  return {
    type: "DECISION",
    requestId: request.requestId,
    decision,
  };
}
