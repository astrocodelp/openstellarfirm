import { describe, expect, it } from "vitest";
import { assistantTurn, listModels, ModelError, streamTurn } from "../models";
import { collect, type Seen, spy, stream } from "./testing";

const chunk = (...parts: unknown[]) =>
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts } }] })}\r\n\r\n`;

const call = {
  baseUrl: "stub://gemini/v1beta",
  wire: "gemini" as const,
  model: "gemini-test",
  apiKey: "AIza-test",
  messages: [
    { role: "system" as const, content: "Be brief." },
    { role: "user" as const, content: "hi" },
  ],
};

describe("gemini wire", () => {
  it("streams text across split chunks", async () => {
    const piece = chunk({ text: "Hel" });
    const fetchImpl = stream([
      piece.slice(0, 25),
      piece.slice(25),
      chunk({ text: "lo" }),
      chunk({ text: "(a thought)", thought: true }),
    ]);
    expect(await collect(streamTurn({ ...call, fetchImpl }))).toEqual({
      text: "Hello",
      calls: [],
    });
  });

  it("makes ids for calls and keeps each thought signature", async () => {
    const fetchImpl = stream([
      chunk({ text: "Looking." }),
      chunk({
        functionCall: { name: "read_file", args: { path: "x" } },
        thoughtSignature: "sig-1",
      }),
      chunk({ functionCall: { name: "find_files" } }),
    ]);
    const { text, calls } = await collect(streamTurn({ ...call, fetchImpl }));
    expect(text).toBe("Looking.");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      name: "read_file",
      arguments: '{"path":"x"}',
      signature: "sig-1",
    });
    expect(calls[1]).toMatchObject({ name: "find_files", arguments: "{}" });
    expect(calls[1]).not.toHaveProperty("signature");
    expect(calls[0]?.id).toBeTruthy();
    expect(calls[0]?.id).not.toBe(calls[1]?.id);
  });

  it("round trips a tool result and echoes the thought signature unchanged", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream([chunk({ text: "ok" })]), seen);
    const calls = [
      {
        id: "g1",
        name: "read_file",
        arguments: '{"path":"x"}',
        signature: "sig-1",
      },
      { id: "g2", name: "find_files", arguments: "{}" },
    ];
    await collect(
      streamTurn({
        ...call,
        fetchImpl,
        tools: [
          {
            name: "read_file",
            description: "d",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: { path: { type: "string" } },
            },
          },
          {
            name: "find_files",
            description: "d",
            parameters: { type: "object", properties: {} },
          },
        ],
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "read it" },
          assistantTurn("On it.", calls),
          { role: "tool", tool_call_id: "g1", content: "file text" },
          { role: "tool", tool_call_id: "g2", content: "none" },
        ],
      }),
    );
    const sent = seen[0];
    expect(sent?.url).toBe(
      "stub://gemini/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
    );
    expect(sent?.body.systemInstruction).toEqual({
      parts: [{ text: "Be brief." }],
    });
    expect(sent?.body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "d",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
            },
          },
          { name: "find_files", description: "d" },
        ],
      },
    ]);
    expect(sent?.body.contents).toEqual([
      { role: "user", parts: [{ text: "read it" }] },
      {
        role: "model",
        parts: [
          { text: "On it." },
          {
            functionCall: { name: "read_file", args: { path: "x" } },
            thoughtSignature: "sig-1",
          },
          { functionCall: { name: "find_files", args: {} } },
        ],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "read_file",
              response: { result: "file text" },
            },
          },
          {
            functionResponse: {
              name: "find_files",
              response: { result: "none" },
            },
          },
        ],
      },
    ]);
  });

  it("keeps the key in a header and never in the address", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream([chunk({ text: "ok" })]), seen);
    await collect(streamTurn({ ...call, fetchImpl }));
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("AIza-test");
    expect(seen[0]?.url).not.toContain("AIza-test");
    expect(seen[0]?.url).not.toContain("key=");
    expect(JSON.stringify(seen[0]?.body)).not.toContain("AIza-test");
    expect(seen[0]?.init.redirect).toBe("error");
  });

  it("refuses a model name that could change the address", async () => {
    for (const model of ["a/b", "a?x=1", "a b", "", "m#x", "../x", "m:x"]) {
      const error = await collect(
        streamTurn({ ...call, model, fetchImpl: stream([]) }),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ModelError);
      expect(error.message).toMatch(/characters Gemini does not take/);
    }
  });

  it("stops mid-stream when asked", async () => {
    const controller = new AbortController();
    const fetchImpl = stream([chunk({ text: "one" }), chunk({ text: "two" })]);
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
    expect(error.message).toBe("Stopped.");
    expect(events).toEqual(["one"]);
  });

  it("takes the key out of an error's reason", async () => {
    const fetchImpl = stream(
      [
        JSON.stringify({
          error: { code: 400, message: "bad\nAIza-test value" },
        }),
      ],
      400,
    );
    const error = await collect(streamTurn({ ...call, fetchImpl })).catch(
      (e) => e,
    );
    expect(error.message).toBe(
      "The model turned the request down: bad [key] value",
    );
  });

  it("reads Google's 400 for an unknown key as a refused key", async () => {
    const fetchImpl = stream(
      [
        JSON.stringify({
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
          },
        }),
      ],
      400,
    );
    const error = await collect(streamTurn({ ...call, fetchImpl })).catch(
      (e) => e,
    );
    expect(error.message).toBe(
      "The model refused the key. Check it in Models.",
    );
  });

  it("lists only models that can answer, without the models/ prefix", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(
      async () =>
        Response.json({
          models: [
            {
              name: "models/gemini-b",
              supportedGenerationMethods: ["generateContent", "countTokens"],
            },
            {
              name: "models/embed-1",
              supportedGenerationMethods: ["embedContent"],
            },
            {
              name: "models/gemini-a",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/odd name",
              supportedGenerationMethods: ["generateContent"],
            },
            { nope: 1 },
          ],
        }),
      seen,
    );
    expect(
      await listModels({
        baseUrl: "stub://gemini/v1beta",
        wire: "gemini",
        apiKey: "AIza-test",
        fetchImpl,
      }),
    ).toEqual(["gemini-a", "gemini-b"]);
    expect(seen[0]?.url).toBe("stub://gemini/v1beta/models?pageSize=1000");
    expect(
      ((seen[0]?.init.headers ?? {}) as Record<string, string>)[
        "x-goog-api-key"
      ],
    ).toBe("AIza-test");
    expect(seen[0]?.url).not.toContain("AIza-test");
  });

  it("refuses an answer that is not a model list", async () => {
    const fetchImpl: typeof fetch = async () => Response.json({ data: [] });
    await expect(
      listModels({ baseUrl: "stub://x", wire: "gemini", fetchImpl }),
    ).rejects.toThrow(/did not answer like a model service/);
  });
});
