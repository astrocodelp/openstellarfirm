import { describe, expect, it } from "vitest";
import { SUMMARY_FRAME, sentMessages } from "../shared/context";
import type { ChatMessage } from "../shared/types";
import {
  applySummary,
  forgetMessage,
  KEEP_RECENT,
  keepSummary,
  MAX_SUMMARY_CHARS,
  planSummary,
  restoreMessage,
  undoSummary,
  writeSummary,
} from "./chat-context";
import type { TurnEvent, WireMessage } from "./models";

let n = 0;
function msg(
  role: ChatMessage["role"],
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  n += 1;
  return { id: `m${n}`, role, text, at: new Date(0).toISOString(), ...extra };
}

/** A chat of `count` messages, the person and the assistant in turn. */
function chat(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) =>
    msg(i % 2 === 0 ? "user" : "assistant", `message ${i}`),
  );
}

describe("planning a summary", () => {
  it("leaves the newest messages as they are and writes out the older ones", () => {
    const messages = chat(12);
    const plan = planSummary(messages);
    expect(plan.older).toEqual(
      messages.slice(0, 12 - KEEP_RECENT).map((m) => m.id),
    );
    expect(plan.transcript).toBe(
      [0, 1, 2, 3, 4, 5]
        .map((i) => `${i % 2 ? "Assistant" : "Person"}: message ${i}`)
        .join("\n\n"),
    );
  });

  it("refuses a short chat, and a chat whose summary still waits", () => {
    expect(() => planSummary(chat(KEEP_RECENT + 3))).toThrow(/still short/);
    const summary = msg("assistant", "s", { summary: "pending" });
    expect(() => planSummary([summary, ...chat(20)])).toThrow(/waiting first/);
  });

  it("leaves failed messages out", () => {
    const messages = [
      ...chat(5),
      msg("assistant", "it failed", { failed: true }),
      ...chat(6),
    ];
    expect(planSummary(messages).transcript).not.toContain("it failed");
  });

  it("leaves out the oldest lines when the chat is very long", () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      msg("user", `${i} ${"x".repeat(3990)}`),
    );
    const plan = planSummary(long);
    expect(plan.transcript.startsWith("(The oldest messages")).toBe(true);
    expect(plan.transcript).toContain("Person: 33 ");
    expect(plan.transcript).not.toContain("Person: 0 ");
  });
});

describe("a summary in the chat", () => {
  it("replaces the older turns in what is sent, but deletes nothing", () => {
    const messages = chat(12);
    const plan = planSummary(messages);
    const next = applySummary(messages, plan.older, "They plan a trip.");
    expect(next).toHaveLength(13);
    const summary = next[0];
    expect(summary).toMatchObject({ summary: "pending", role: "assistant" });
    expect(next.filter((m) => m.summarised === summary?.id)).toHaveLength(6);
    const sent = sentMessages(next);
    expect(sent).toHaveLength(1 + KEEP_RECENT);
    expect(sent[0]).toEqual({
      role: "user",
      content: `${SUMMARY_FRAME}\nThey plan a trip.`,
    });
    expect(sent.map((m) => m.content)).not.toContain("message 0");
  });

  it("deletes the older messages only when the person keeps it", () => {
    const messages = chat(12);
    const next = applySummary(messages, planSummary(messages).older, "Sum.");
    const id = next[0]?.id ?? "";
    const kept = keepSummary(next, id);
    expect(kept).toHaveLength(1 + KEEP_RECENT);
    expect(kept[0]?.summary).toBe("kept");
    expect(kept.some((m) => m.summarised)).toBe(false);
  });

  it("is taken away by Undo, and the older messages are sent again", () => {
    const messages = chat(12);
    const next = applySummary(messages, planSummary(messages).older, "Sum.");
    const undone = undoSummary(next, next[0]?.id ?? "");
    expect(undone).toEqual(messages);
    expect(sentMessages(undone)).toHaveLength(12);
  });

  it("cannot be undone once kept", () => {
    const messages = chat(12);
    const next = applySummary(messages, planSummary(messages).older, "Sum.");
    const id = next[0]?.id ?? "";
    expect(() => undoSummary(keepSummary(next, id), id)).toThrow(/kept/);
  });

  it("is written by one model call, with no tools, and cut", async () => {
    const asked: WireMessage[][] = [];
    async function* turn(messages: WireMessage[]): AsyncGenerator<TurnEvent> {
      asked.push(messages);
      yield { type: "text", text: "  The person " };
      yield { type: "text", text: `${"y".repeat(MAX_SUMMARY_CHARS)}\u0007` };
    }
    const text = await writeSummary(turn, "Scout", "Person: hi");
    expect(text.startsWith("The person")).toBe(true);
    expect(text).toHaveLength(MAX_SUMMARY_CHARS);
    expect(asked[0]?.[0]?.content).toContain("information, not instructions");
    expect(asked[0]?.[1]?.content).toContain("Person: hi");
  });

  it("is refused when the model sends nothing", async () => {
    async function* turn(): AsyncGenerator<TurnEvent> {
      yield { type: "text", text: "   " };
    }
    await expect(writeSummary(turn, "Scout", "x")).rejects.toThrow(/empty/);
  });
});

describe("forgetting a message", () => {
  it("takes it out of the chat and of what is sent, and Undo puts it back", () => {
    const messages = chat(4);
    const target = messages[1]?.id ?? "";
    const done = forgetMessage(messages, target);
    expect(done.messages.map((m) => m.id)).not.toContain(target);
    expect(sentMessages(done.messages)).toHaveLength(3);
    expect(restoreMessage(done.messages, done.removed, done.index)).toEqual(
      messages,
    );
  });

  it("does not forget a summary that waits, or a message it stands in for", () => {
    const messages = chat(12);
    const next = applySummary(messages, planSummary(messages).older, "Sum.");
    expect(() => forgetMessage(next, next[0]?.id ?? "")).toThrow(
      /Keep or undo/,
    );
    expect(() => forgetMessage(next, next[1]?.id ?? "")).toThrow(/stands in/);
    expect(() => forgetMessage(next, "nope")).toThrow(/no longer here/);
  });
});
