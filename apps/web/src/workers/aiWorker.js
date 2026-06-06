import { handleAiWorkerRequest } from "./aiWorkerCore.js";

self.addEventListener("message", async (event) => {
  const request = event.data;

  try {
    const response = await handleAiWorkerRequest(request);
    if (response) {
      self.postMessage(response);
    }
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});
