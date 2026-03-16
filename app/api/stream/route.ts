import { getState, subscribe } from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { signal } = request;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (state: ReturnType<typeof getState>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
        } catch {
          // client disconnected
        }
      };
      send(getState());
      const unsubscribe = subscribe((s) => send(s));
      signal?.addEventListener?.("abort", () => {
        unsubscribe();
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache",
      Connection: "keep-alive",
    },
  });
}
