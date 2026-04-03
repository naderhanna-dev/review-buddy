import type { ReviewSession } from "./session";

export function createSSEStream(session: ReviewSession): Response {
  const stream = new ReadableStream({
    start(controller) {
      session.sseClients.add(controller);
      // Send current session status as first event
      const status = {
        type: "session:status",
        status: session.status,
        pr: session.pr ? { title: session.pr.title, number: session.pr.number } : null,
      };
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(status)}\n\n`),
      );
    },
    cancel(controller) {
      session.sseClients.delete(controller as ReadableStreamDefaultController);
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
