import { describe, expect, it } from "vitest";
import {
  cleanNoteText,
  looksLikeSecret,
  MAX_NOTE_CHARS,
  SECRET_REFUSAL,
} from "./memory";
import { systemPrompt } from "./prompt";

describe("a note", () => {
  it("is plain text, trimmed, with control characters out", () => {
    expect(cleanNoteText("  Prefers   short\u0007 answers.  ")).toBe(
      "Prefers short answers.",
    );
    expect(cleanNoteText("Line one\n\n  line two")).toBe("Line one\nline two");
  });

  it("must have words, and at most 500 characters", () => {
    expect(() => cleanNoteText("   ")).toThrow("Write the note first.");
    expect(() => cleanNoteText(42)).toThrow("Write the note first.");
    expect(cleanNoteText("a".repeat(MAX_NOTE_CHARS))).toHaveLength(
      MAX_NOTE_CHARS,
    );
    expect(() => cleanNoteText("a ".repeat(MAX_NOTE_CHARS))).toThrow(
      /500 characters/,
    );
  });

  it("is refused when it reads like a key, a password or a token", () => {
    for (const secret of [
      "My OpenAI key is sk-proj-abcdefghijklmnop1234",
      "stripe sk_live_51HabcdefGHIJ1234",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "Slack xoxb-1234567890-abcdefghij",
      "AWS AKIAIOSFODNN7EXAMPLE",
      "AIzaSyA1234567890abcdefghijklmnopqrstu",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijk",
      "-----BEGIN RSA PRIVATE KEY----- MIIE",
      "Authorization: Bearer abcdefghijklmnopqrstuvwx",
      "my password is hunter22",
      "Wi-Fi password: correct-horse",
      "the PIN is 4821",
      "api key = 1234abcd",
      "token: a1b2c3d4e5",
      "hf_abcdefghijklmnopqrstuvwxyz12",
      "8f14e45fceea167a5a36dedd4bea2543aa0b1c2d3e4f",
      "https://example.com/hook?token=AbCdEf0123456789AbCdEf0123456789",
    ]) {
      expect(looksLikeSecret(secret), secret).toBe(true);
      expect(() => cleanNoteText(secret)).toThrow(SECRET_REFUSAL);
    }
  });

  it("keeps ordinary facts, even with numbers and addresses", () => {
    for (const fact of [
      "Prefers short answers.",
      "Works at a bakery in Lisbon, opens at 7am.",
      "Their daughter's birthday is on 12 March 2019.",
      "Uses https://example.com/docs/getting-started-with-the-new-tools a lot.",
      "Likes the token economy chapter of the book.",
      "Password managers: uses the one built into the browser.",
    ]) {
      expect(looksLikeSecret(fact), fact).toBe(false);
    }
  });
});

describe("the instructions", () => {
  const base = {
    name: "Scout",
    brief: "Plan trips.",
    skills: [],
    folderLabels: [],
    web: false,
  };

  it("hold the notes under a line that says they are the person's saved notes", () => {
    const prompt = systemPrompt({
      ...base,
      notes: ["Prefers trains.", "Lives in\nPorto."],
    });
    expect(prompt).toContain("The person's saved notes for you");
    expect(prompt).toContain("- Prefers trains.\n- Lives in Porto.");
  });

  it("say nothing about memory when there are no notes and no remember", () => {
    const prompt = systemPrompt(base);
    expect(prompt).not.toContain("saved notes");
    expect(prompt).not.toContain("remember");
    // An assistant with no tools still says it can only talk.
    expect(prompt).toContain("You can only talk in this chat.");
  });

  it("explain remember, and its limits, only when it is offered", () => {
    const prompt = systemPrompt({ ...base, canRemember: true });
    expect(prompt).toContain("with remember");
    expect(prompt).toContain("Never save a key, password or token.");
    expect(prompt).toContain("You can only talk in this chat.");
  });
});
