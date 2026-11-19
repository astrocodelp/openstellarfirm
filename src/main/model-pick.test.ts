import { describe, expect, it } from "vitest";
import { bestModel, pickLocalModel } from "./model-pick";

function stubFetch(routes: Record<string, (body: unknown) => unknown>) {
  const asked: string[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const key = String(url);
    asked.push(key);
    const route = routes[key];
    if (!route) return new Response("not here", { status: 404 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify(route(body)), { status: 200 });
  }) as typeof fetch;
  return { impl, asked };
}

describe("picking a first model", () => {
  it("prefers a model that uses tools and reads pictures, then the newest", async () => {
    const caps: Record<string, string[]> = {
      "aaa-embed:latest": ["embedding"],
      "basic:7b": ["completion"],
      "tools:8b": ["completion", "tools"],
      "old-vision:12b": ["completion", "tools", "vision"],
      "new-vision:27b": ["completion", "tools", "vision", "thinking"],
    };
    const { impl } = stubFetch({
      "stub://ollama/api/tags": () => ({
        models: [
          { name: "aaa-embed:latest", modified_at: "2026-11-01T00:00:00Z" },
          { name: "basic:7b", modified_at: "2026-11-02T00:00:00Z" },
          { name: "tools:8b", modified_at: "2026-11-03T00:00:00Z" },
          { name: "old-vision:12b", modified_at: "2026-01-01T00:00:00Z" },
          { name: "new-vision:27b", modified_at: "2026-10-01T00:00:00Z" },
        ],
      }),
      "stub://ollama/api/show": (body) => ({
        capabilities: caps[(body as { model: string }).model],
      }),
    });
    const pick = await pickLocalModel(
      "ollama",
      "stub://ollama/v1",
      Object.keys(caps).sort(),
      { fetchImpl: impl },
    );
    expect(pick).toEqual({
      model: "new-vision:27b",
      reason: "it can use tools and read pictures.",
    });
  });

  it("says when the pick is also the newest", () => {
    expect(
      bestModel([
        { name: "a", can: new Set(["completion", "tools"]), at: 1 },
        { name: "b", can: new Set(["completion", "tools"]), at: 2 },
      ]),
    ).toEqual({
      model: "b",
      reason: "it can use tools, and it is the newest here.",
    });
  });

  it("never picks a model that only makes embeddings", () => {
    expect(
      bestModel([
        { name: "embed", can: new Set(["embedding"]), at: 9 },
        { name: "chat", can: new Set(["completion"]), at: 1 },
      ])?.model,
    ).toBe("chat");
    expect(
      bestModel([{ name: "embed", can: new Set(["embedding"]), at: 9 }]),
    ).toBeUndefined();
  });

  it("falls back to the names when the program says nothing more", async () => {
    const { impl } = stubFetch({});
    const pick = await pickLocalModel(
      "ollama",
      "stub://ollama/v1",
      ["all-minilm:latest", "llama3:8b"],
      { fetchImpl: impl },
    );
    expect(pick).toEqual({
      model: "llama3:8b",
      reason: "it is the first model listed.",
    });
  });

  it("reads LM Studio's own list of model types", async () => {
    const { impl, asked } = stubFetch({
      "stub://lms/api/v0/models": () => ({
        data: [
          { id: "text-embedding-nomic", type: "embeddings" },
          { id: "chat-small", type: "llm" },
          { id: "see-and-tools", type: "vlm", capabilities: ["tool_use"] },
        ],
      }),
    });
    const pick = await pickLocalModel(
      "lmstudio",
      "stub://lms/v1",
      ["chat-small", "see-and-tools", "text-embedding-nomic"],
      { fetchImpl: impl },
    );
    expect(pick?.model).toBe("see-and-tools");
    expect(asked).toEqual(["stub://lms/api/v0/models"]);
  });
});
