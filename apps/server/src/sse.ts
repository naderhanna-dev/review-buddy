import type { ReviewSession } from "./session";

export function createSSEStream(session: ReviewSession): Response {
  let ctrl: ReadableStreamDefaultController;

  const stream = new ReadableStream({
    start(controller) {
      ctrl = controller;
      session.sseClients.add(controller);
      const status = {
        type: "session:status",
        status: session.status,
        pr: session.pr ? { title: session.pr.title, number: session.pr.number } : null,
      };
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(status)}\n\n`),
      );
    },
    cancel() {
      // cancel() receives the cancellation reason, not the controller —
      // use the controller captured from start() via closure
      session.sseClients.delete(ctrl);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
