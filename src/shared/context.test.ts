import { describe, expect, it } from "vitest";
import {
  contextShare,
  contextTokens,
  contextWindow,
  estimateTokens,
  PROMPT_TOKENS,
  SENT_MESSAGES,
  SUMMARY_FRAME,
  sentMessages,
} from "./context";
import type { ChatMessage } from "./types";

let n = 0;
function msg(
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  n += 1;
  return { id: `m${n}`, role, text, at: new Date(0).toISOString(), ...extra };
}

describe("the token estimate", () => {
  it("is about four characters a token, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
  });

  it("counts the instructions, the brief, the notes and what is sent", () => {
    const empty = contextTokens({ brief: "", notes: [], messages: [] });
    expect(empty).toBe(PROMPT_TOKENS);
    const full = contextTokens({
      brief: "x".repeat(400),
      notes: ["y".repeat(397)],
      messages: [msg("user", "z".repeat(392))],
    });
    // 400 + (397 + 3) + (392 + 8) characters is 1,200, or 300 tokens.
    expect(full).toBe(PROMPT_TOKENS + 300);
  });

  it("leaves out failed messages and the ones a summary stands in for", () => {
    const tokens = contextTokens({
      brief: "",
      notes: [],
      messages: [
        msg("assistant", "x".repeat(4000), { failed: true }),
        msg("user", "x".repeat(4000), { summarised: "s" }),
      ],
    });
    expect(tokens).toBe(PROMPT_TOKENS);
  });
});

describe("the window", () => {
  it("is known for well-known families, through a router's prefix too", () => {
    expect(contextWindow("claude-sonnet-4-5")).toBe(200_000);
    expect(contextWindow("anthropic/claude-opus-4")).toBe(200_000);
    expect(contextWindow("gpt-4o-mini")).toBe(128_000);
    expect(contextWindow("gemini-2.5-flash")).toBe(1_048_576);
  });

  it("is not known for anything else, or a runtime that sets its own", () => {
    expect(contextWindow("my-fine-tune")).toBeUndefined();
    expect(contextWindow(undefined)).toBeUndefined();
    expect(contextWindow("llama3.1:8b", "ollama")).toBeUndefined();
    expect(contextWindow("llama3.1", "lmstudio")).toBeUndefined();
    expect(contextWindow("llama3.1:8b", "openrouter")).toBe(128_000);
  });

  it("gives a share only when the window is known, and never past full", () => {
    expect(contextShare(1000, undefined)).toBeUndefined();
    expect(contextShare(50_000, 100_000)).toBe(0.5);
    expect(contextShare(300_000, 100_000)).toBe(1);
  });
});

describe("what a chat sends", () => {
  it("is the newest messages that worked, as plain turns", () => {
    const chat = [
      msg("user", "hi"),
      msg("assistant", "no", { failed: true }),
      msg("assistant", "hello"),
    ];
    expect(sentMessages(chat)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("sends a summary in place of the older messages, framed as information", () => {
    const summary = msg("assistant", "They want a quiet trip.", {
      summary: "pending",
    });
    const chat = [
      msg("user", "old one", { summarised: summary.id }),
      summary,
      msg("user", "old two", { summarised: summary.id }),
      msg("user", "new"),
    ];
    expect(sentMessages(chat)).toEqual([
      { role: "user", content: `${SUMMARY_FRAME}\nThey want a quiet trip.` },
      { role: "user", content: "new" },
    ]);
  });

  it("keeps the newest summary even when the chat grows past it", () => {
    const summary = msg("assistant", "Summed up.", { summary: "kept" });
    const later = Array.from({ length: SENT_MESSAGES + 5 }, (_, i) =>
      msg(i % 2 ? "assistant" : "user", `m${i}`),
    );
    const sent = sentMessages([summary, ...later]);
    expect(sent).toHaveLength(SENT_MESSAGES);
    expect(sent[0]?.content).toContain("Summed up.");
    expect(sent.at(-1)?.content).toBe(`m${SENT_MESSAGES + 4}`);
  });
});
