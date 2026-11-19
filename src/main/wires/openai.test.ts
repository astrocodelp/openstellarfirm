import { describe, expect, it } from "vitest";
import { listModels, streamTurn } from "../models";
import { collect, stream } from "./testing";

const KEY = "sk-secret-123";

/** A fake service that records what it was asked, and answers a short turn. */
function recording() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push({
      url: String(url),
      headers: { ...(init?.headers as Record<string, string>) },
    });
    if (init?.method === "POST") {
      return stream([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
        "data: [DONE]\n\n",
      ])(url, init);
    }
    return new Response(JSON.stringify({ data: [{ id: "m1" }] }));
  };
  return { seen, fetchImpl };
}

const turn = {
  baseUrl: "https://example.test/v1",
  model: "m",
  apiKey: KEY,
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("the key header", () => {
  it("sends a Bearer key by default and no api-key header", async () => {
    const { seen, fetchImpl } = recording();
    await collect(streamTurn({ ...turn, fetchImpl }));
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.headers["api-key"]).toBeUndefined();
  });

  it("sends an api-key header and no Authorization when asked, for a turn and a list", async () => {
    const { seen, fetchImpl } = recording();
    await collect(streamTurn({ ...turn, auth: "api-key", fetchImpl }));
    await listModels({
      baseUrl: turn.baseUrl,
      apiKey: KEY,
      auth: "api-key",
      fetchImpl,
    });
    for (const call of seen) {
      expect(call.headers["api-key"]).toBe(KEY);
      expect(call.headers.authorization).toBeUndefined();
    }
  });

  it("sends a Bearer key on a list too", async () => {
    const { seen, fetchImpl } = recording();
    await listModels({
      baseUrl: turn.baseUrl,
      apiKey: KEY,
      auth: "bearer",
      fetchImpl,
    });
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.headers["api-key"]).toBeUndefined();
  });

  it("sends no key header when there is no key, and never puts it in an address", async () => {
    const { seen, fetchImpl } = recording();
    await collect(streamTurn({ ...turn, apiKey: undefined, fetchImpl }));
    expect(seen[0]?.headers.authorization).toBeUndefined();
    const withKey = recording();
    await collect(streamTurn({ ...turn, fetchImpl: withKey.fetchImpl }));
    await listModels({
      baseUrl: turn.baseUrl,
      apiKey: KEY,
      fetchImpl: withKey.fetchImpl,
    });
    for (const call of withKey.seen) expect(call.url).not.toContain(KEY);
  });
});
