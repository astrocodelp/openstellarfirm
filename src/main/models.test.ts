import { describe, expect, it } from "vitest";
import {
  assistantTurn,
  listModels,
  ModelError,
  SseParser,
  streamTurn,
  type TurnEvent,
} from "./models";

/** A fake model service. No test here touches the network. */
function sse(chunks: string[], status = 200): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(new TextEncoder().encode(chunk));
          controller.close();
        },
      }),
      { status },
    );
}

const data = (delta: unknown) =>
  `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const delta = (text: string) => data({ content: text });

async function collect(stream: AsyncGenerator<TurnEvent>) {
  let text = "";
  let calls: Extract<TurnEvent, { type: "calls" }>["calls"] = [];
  for await (const event of stream) {
    if (event.type === "text") text += event.text;
    else calls = event.calls;
  }
  return { text, calls };
}

const call = {
  baseUrl: "stub://model/v1",
  model: "m",
  messages: [{ role: "user" as const, content: "hi" }],
};

describe("SseParser", () => {
  it("joins an event that arrives in pieces", () => {
    const parser = new SseParser();
    expect(parser.push('data: {"a"')).toEqual([]);
    expect(parser.push(":1}\r\n\r\ndata: [DONE]\n")).toEqual([
      '{"a":1}',
      "[DONE]",
    ]);
  });

  it("ignores comments and other fields", () => {
    expect(new SseParser().push(": ping\nevent: x\ndata: y\n")).toEqual(["y"]);
  });
});

describe("streamTurn", () => {
  it("yields the text and stops at [DONE]", async () => {
    const half = delta("Hel");
    const fetchImpl = sse([
      half.slice(0, 9),
      half.slice(9),
      delta("lo"),
      "data: [DONE]\n\n",
      delta("never"),
    ]);
    expect(await collect(streamTurn({ ...call, fetchImpl }))).toEqual({
      text: "Hello",
      calls: [],
    });
  });

  it("joins tool calls that arrive in pieces, by their index", async () => {
    const fetchImpl = sse([
      data({
        tool_calls: [
          {
            index: 0,
            id: "a",
            function: { name: "read_file", arguments: '{"pa' },
          },
        ],
      }),
      data({ tool_calls: [{ index: 1, function: { name: "find_files" } }] }),
      data({ tool_calls: [{ index: 0, function: { arguments: 'th":"x"}' } }] }),
      data({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] }),
      "data: [DONE]\n\n",
    ]);
    expect((await collect(streamTurn({ ...call, fetchImpl }))).calls).toEqual([
      { id: "a", name: "read_file", arguments: '{"path":"x"}' },
      { id: "call_1", name: "find_files", arguments: "{}" },
    ]);
  });

  it("sends tools only when there are some", async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(delta("ok"));
    };
    await collect(streamTurn({ ...call, fetchImpl }));
    await collect(
      streamTurn({
        ...call,
        fetchImpl,
        tools: [
          { name: "t", description: "d", parameters: { type: "object" } },
        ],
      }),
    );
    expect(JSON.parse(bodies[0] ?? "{}")).not.toHaveProperty("tools");
    expect(JSON.parse(bodies[1] ?? "{}").tools).toEqual([
      {
        type: "function",
        function: {
          name: "t",
          description: "d",
          parameters: { type: "object" },
        },
      },
    ]);
  });

  it("does not send a call's signature on the OpenAI wire", async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body));
      return new Response(delta("ok"));
    };
    const calls = [{ id: "a", name: "t", arguments: "{}", signature: "sig" }];
    await collect(
      streamTurn({
        ...call,
        fetchImpl,
        messages: [...call.messages, assistantTurn("", calls)],
      }),
    );
    expect(bodies[0]).not.toContain("sig");
    expect(bodies[0]).toContain('"tool_calls"');
  });

  it("sends the key only as a bearer header, and refuses a redirect", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return new Response(delta("ok"));
    };
    await collect(streamTurn({ ...call, apiKey: "sk-test", fetchImpl }));
    expect(seen?.url).toBe("stub://model/v1/chat/completions");
    expect(seen?.url).not.toContain("sk-test");
    expect(String(seen?.init.body)).not.toContain("sk-test");
    const sent = seen?.init.headers as Record<string, string> | undefined;
    expect(sent?.authorization).toBe("Bearer sk-test");
    expect(seen?.init.redirect).toBe("error");
  });

  it("turns a refusal into a plain sentence that holds nothing the server wrote", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("secret server text sk-test", { status: 401 });
    const error = await collect(
      streamTurn({ ...call, apiKey: "sk-test", fetchImpl }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error.status).toBe(401);
    expect(error.message).toBe(
      "The model refused the key. Check it in Models.",
    );
  });

  it("shows a bad request's own reason, on one line, without the key", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json(
        { error: { message: "bad sampler\nsettings for sk-test" } },
        { status: 400 },
      );
    const error = await collect(
      streamTurn({ ...call, apiKey: "sk-test", fetchImpl }),
    ).catch((e) => e);
    expect(error.message).toBe(
      "The model turned the request down: bad sampler settings for [key]",
    );
  });

  it("says so when the model cannot be reached", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:11434");
    };
    const error = await collect(streamTurn({ ...call, fetchImpl })).catch(
      (e) => e,
    );
    expect(error.message).toMatch(/could not be reached/);
    expect(error.message).not.toContain("ECONNREFUSED");
  });
});

describe("listModels", () => {
  it("returns the model names, sorted", async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({ data: [{ id: "b" }, { id: "a" }, { nope: 1 }] });
    expect(await listModels({ baseUrl: "stub://model/v1", fetchImpl })).toEqual(
      ["a", "b"],
    );
  });

  it("refuses an answer that is not a model list", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>", { status: 200 });
    await expect(
      listModels({ baseUrl: "stub://model/v1", fetchImpl }),
    ).rejects.toThrow(/did not answer like a model service/);
  });
});
