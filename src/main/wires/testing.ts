/** Shared helpers for the wire tests. Nothing here touches the network. */
import type { TurnEvent } from "./common";

/** A fake model service that answers with these chunks, then closes. */
export function stream(chunks: string[], status = 200): typeof fetch {
  return async (_url, init) => {
    const signal = init?.signal ?? undefined;
    return new Response(
      new ReadableStream({
        start(controller) {
          // A stop errors the stream, as a real fetch does.
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            controller.error(error);
          });
          for (const chunk of chunks)
            controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status },
    );
  };
}

export async function collect(stream: AsyncGenerator<TurnEvent>) {
  let text = "";
  let calls: Extract<TurnEvent, { type: "calls" }>["calls"] = [];
  for await (const event of stream) {
    if (event.type === "text") text += event.text;
    else calls = event.calls;
  }
  return { text, calls };
}

export interface Seen {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

/** Wraps a fake so the test can read what was sent. */
export function spy(inner: typeof fetch, seen: Seen[]): typeof fetch {
  return async (url, init) => {
    seen.push({
      url: String(url),
      init: init ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return inner(url, init);
  };
}
