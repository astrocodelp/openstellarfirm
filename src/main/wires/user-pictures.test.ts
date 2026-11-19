import { describe, expect, it } from "vitest";
import type { WireMessage } from "../models";
import { streamTurn } from "../models";
import { toAnthropic } from "./anthropic";
import { toGemini } from "./gemini";
import { collect, type Seen, spy, stream } from "./testing";

/** Pictures beside a person's text, as a recording's draft sends them. */
const images = [
  { mediaType: "image/jpeg", data: "QUJD" },
  { mediaType: "image/jpeg", data: "REVG" },
];
const messages: WireMessage[] = [
  { role: "system", content: "S" },
  { role: "user", content: "What changed?", images },
];

describe("pictures beside a person's text", () => {
  it("go to an OpenAI-style service as parts of the user message", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream(["data: [DONE]\n\n"]), seen);
    await collect(
      streamTurn({ baseUrl: "stub://x/v1", model: "m", messages, fetchImpl }),
    );
    const sent = seen[0]?.body.messages as Record<string, unknown>[];
    expect(sent[0]).toEqual({ role: "system", content: "S" });
    expect(sent[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What changed?" },
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,QUJD" },
        },
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,REVG" },
        },
      ],
    });
  });

  it("leave a user message with no pictures as plain text", async () => {
    const seen: Seen[] = [];
    const fetchImpl = spy(stream(["data: [DONE]\n\n"]), seen);
    await collect(
      streamTurn({
        baseUrl: "stub://x/v1",
        model: "m",
        messages: [{ role: "user", content: "hi", images: [] }],
        fetchImpl,
      }),
    );
    const sent = seen[0]?.body.messages as Record<string, unknown>[];
    expect(sent[0]).toEqual({ role: "user", content: "hi", images: [] });
  });

  it("go to Anthropic as image blocks after the text", () => {
    const { turns } = toAnthropic(messages);
    expect(turns[0]?.content).toEqual([
      { type: "text", text: "What changed?" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "REVG" },
      },
    ]);
  });

  it("go to Gemini as inline parts after the text", () => {
    const { contents } = toGemini(messages);
    expect(contents[0]).toEqual({
      role: "user",
      parts: [
        { text: "What changed?" },
        { inlineData: { mimeType: "image/jpeg", data: "QUJD" } },
        { inlineData: { mimeType: "image/jpeg", data: "REVG" } },
      ],
    });
  });
});
