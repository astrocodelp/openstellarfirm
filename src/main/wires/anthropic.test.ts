import { describe, expect, it } from "vitest";
import { assistantTurn, listModels, ModelError, streamTurn } from "../models";
import { collect, type Seen, spy, stream } from "./testing";

const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const textDelta = (text: string, index = 0) =>
  ev({
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  });

const call = {
  baseUrl: "stub://claude/v1",
  wire: "anthropic" as const,
  model: "claude-test",
  apiKey: "sk-ant-test",
  messages: [
    { role: "system" as const, content: "Be brief." },
    { role: "user" as const, content: "hi" },
  ],
};

describe("anthropic wire", () => {
  it("streams text across split chunks", async () => {
    const piece = textDelta("Hel");
    const fetchImpl = stream([
      ev({ type: "message_start", message: { id: "m" } }),
      ev({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      piece.slice(0, 20),
      piece.slice(20),
      ": ping\n\n",
      textDelta("lo"),
      ev({ type: "content_block_stop", index: 0 }),
      ev({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      ev({ type: "message_stop" }),
    ]);
    expect(await collect(streamTurn({ ...call, fetchImpl }))).toEqual({
      text: "Hello",
      calls: [],
    });
  });

  it("joins a tool call from its streamed pieces", async () => {
    const fetchImpl = stream([
      ev({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      textDelta("Looking."),
      ev({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_1", name: "read_file" },
      }),
      ev({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"pa' },
      }),
      ev({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: 'th":"x"}' },
      }),
      ev({
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "toolu_2", name: "find_files" },
      }),
      ev({ type: "content_block_stop", index: 2 }),
      ev({ type: "message_stop" }),
    ]);
    const result = await collect(streamTurn({ ...call, fetchImpl }));
    expect(result.text).toBe("Looking.");
    expect(result.calls).toEqual([
      { id: "toolu_1", name: "read_file", arguments: '{"path":"x"}' },
      { id: "toolu_2", name: "find_files", arguments: "{}" },
    ]);
  });

  it("sends the system prompt, tools, a ceiling, and the tool result round trip", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream([ev({ type: "message_stop" })]), seen);
    const calls = [
      { id: "toolu_1", name: "read_file", arguments: '{"path":"x"}' },
      { id: "toolu_2", name: "find_files", arguments: "{}" },
    ];
    await collect(
      streamTurn({
        ...call,
        fetchImpl,
        tools: [
          {
            name: "read_file",
            description: "d",
            parameters: { type: "object" },
          },
        ],
        messages: [
          { role: "system", content: "Be brief." },
          { role: "assistant", content: "I will not be first." },
          { role: "user", content: "read it" },
          assistantTurn("On it.", calls),
          { role: "tool", tool_call_id: "toolu_1", content: "file text" },
          { role: "tool", tool_call_id: "toolu_2", content: "none" },
        ],
      }),
    );
    const body = seen[0]?.body as Record<string, unknown>;
    expect(seen[0]?.url).toBe("stub://claude/v1/messages");
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(8192);
    expect(body.system).toBe("Be brief.");
    expect(body.tools).toEqual([
      { name: "read_file", description: "d", input_schema: { type: "object" } },
    ]);
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read it" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "On it." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "x" },
          },
          { type: "tool_use", id: "toolu_2", name: "find_files", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: "file text" },
          { type: "tool_result", tool_use_id: "toolu_2", content: "none" },
        ],
      },
    ]);
  });

  it("keeps the key in headers only, and refuses a redirect", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream([ev({ type: "message_stop" })]), seen);
    await collect(streamTurn({ ...call, fetchImpl }));
    const sent = seen[0]?.init.headers as Record<string, string>;
    expect(sent["x-api-key"]).toBe("sk-ant-test");
    expect(sent["anthropic-version"]).toBe("2023-06-01");
    expect(sent.authorization).toBeUndefined();
    expect(seen[0]?.url).not.toContain("sk-ant-test");
    expect(JSON.stringify(seen[0]?.body)).not.toContain("sk-ant-test");
    expect(seen[0]?.init.redirect).toBe("error");
  });

  it("stops mid-stream when asked", async () => {
    const controller = new AbortController();
    const fetchImpl = stream([textDelta("one"), textDelta("two")]);
    const events: string[] = [];
    const run = async () => {
      for await (const event of streamTurn({
        ...call,
        fetchImpl,
        signal: controller.signal,
      })) {
        if (event.type === "text") events.push(event.text);
        controller.abort();
      }
    };
    const error = await run().catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.message).toBe("Stopped.");
    expect(events).toEqual(["one"]);
  });

  it("takes the key out of an error's reason, and hides a refusal's text", async () => {
    const bad = stream(
      [
        JSON.stringify({
          type: "error",
          error: { type: "invalid_request_error", message: "bad\nsk-ant-test" },
        }),
      ],
      400,
    );
    const error = await collect(streamTurn({ ...call, fetchImpl: bad })).catch(
      (e) => e,
    );
    expect(error.message).toBe("The model turned the request down: bad [key]");
    const refused = await collect(
      streamTurn({
        ...call,
        fetchImpl: stream(["secret sk-ant-test"], 401),
      }),
    ).catch((e) => e);
    expect(refused.message).toBe(
      "The model refused the key. Check it in Models.",
    );
    expect(refused.status).toBe(401);
  });

  it("turns a stream error event into a plain line", async () => {
    const fetchImpl = stream([
      ev({ type: "error", error: { type: "overloaded_error", message: "x" } }),
    ]);
    const error = await collect(streamTurn({ ...call, fetchImpl })).catch(
      (e) => e,
    );
    expect(error.message).toMatch(/busy/);
  });

  it("lists models by their ids", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(
      async () =>
        Response.json({ data: [{ id: "claude-b" }, { id: "claude-a" }] }),
      seen,
    );
    expect(
      await listModels({
        baseUrl: "stub://claude/v1",
        wire: "anthropic",
        apiKey: "sk-ant-test",
        fetchImpl,
      }),
    ).toEqual(["claude-a", "claude-b"]);
    expect(seen[0]?.url).toBe("stub://claude/v1/models?limit=1000");
    const sent = seen[0]?.init.headers as Record<string, string>;
    expect(sent["x-api-key"]).toBe("sk-ant-test");
    expect(seen[0]?.url).not.toContain("sk-ant-test");
  });

  it("says so when a model list is refused", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("no", { status: 401 });
    await expect(
      listModels({ baseUrl: "stub://x", wire: "anthropic", fetchImpl }),
    ).rejects.toThrow(/refused the key/);
  });
});
