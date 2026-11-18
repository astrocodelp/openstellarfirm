import { describe, expect, it } from "vitest";
import type { WireMessage } from "../models";
import { streamTurn } from "../models";
import { toAnthropic } from "./anthropic";
import { toGemini } from "./gemini";
import { collect, type Seen, spy, stream } from "./testing";

const image = { mediaType: "image/jpeg", data: "QUJD" };
const messages: WireMessage[] = [
  { role: "system", content: "S" },
  { role: "user", content: "look" },
  {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "t1",
        type: "function",
        function: { name: "look_at_screen", arguments: "{}" },
      },
      {
        id: "t2",
        type: "function",
        function: { name: "list_folder", arguments: "{}" },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "t1",
    content: "The screen was captured. The picture follows.",
    image,
  },
  { role: "tool", tool_call_id: "t2", content: "files" },
];

describe("a picture in a tool result", () => {
  it("goes to an OpenAI-style service as text, then a user message with the picture", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream(["data: [DONE]\n\n"]), seen);
    await collect(
      streamTurn({ baseUrl: "stub://x/v1", model: "m", messages, fetchImpl }),
    );
    const sent = seen[0]?.body.messages as Record<string, unknown>[];
    expect(sent.map((m) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "tool",
      "user",
    ]);
    expect(sent[3]).toEqual({
      role: "tool",
      tool_call_id: "t1",
      content: "The screen was captured. The picture follows.",
    });
    const picture = sent[5]?.content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(picture[0]?.type).toBe("text");
    expect(picture[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,QUJD" },
    });
  });

  it("goes to Anthropic inside the tool_result block", () => {
    const { turns } = toAnthropic(messages);
    const results = turns.at(-1)?.content ?? [];
    expect(results[0]).toEqual({
      type: "tool_result",
      tool_use_id: "t1",
      content: [
        { type: "text", text: "The screen was captured. The picture follows." },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
        },
      ],
    });
    expect(results[1]).toEqual({
      type: "tool_result",
      tool_use_id: "t2",
      content: "files",
    });
  });

  it("goes to Gemini as inlineData after the function responses, in the same content", () => {
    const { contents } = toGemini(messages);
    const last = contents.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.parts).toEqual([
      {
        functionResponse: {
          name: "look_at_screen",
          response: { result: "The screen was captured. The picture follows." },
        },
      },
      {
        functionResponse: {
          name: "list_folder",
          response: { result: "files" },
        },
      },
      { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
    ]);
  });

  it("leaves a text-only result exactly as it was on every wire", () => {
    const plain: WireMessage[] = [
      ...messages.slice(0, 3),
      { role: "tool", tool_call_id: "t1", content: "a" },
      { role: "tool", tool_call_id: "t2", content: "b" },
    ];
    expect(JSON.stringify(toAnthropic(plain).turns)).not.toContain("image");
    expect(JSON.stringify(toGemini(plain).contents)).not.toContain(
      "inlineData",
    );
  });
});
