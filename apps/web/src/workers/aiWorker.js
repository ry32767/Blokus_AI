import { isLegalMove } from "../../../../packages/core/src/index.js";
import { decideAiMove, decideHeuristic } from "../ai/engines.js";

self.addEventListener("message", async (event) => {
  const request = event.data;
  if (request.type === "INIT") {
    self.postMessage({ type: "READY", modelLoaded: false });
    return;
  }
  if (request.type === "CANCEL") return;
  if (request.type !== "THINK") return;

  try {
    let decision = await decideAiMove(request.state, request.config);
    if (!isLegalMove(request.state, decision.move)) {
      decision = await decideHeuristic(request.state, request.config);
    }
    self.postMessage({
      type: "DECISION",
      requestId: request.requestId,
      decision,
    });
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});
