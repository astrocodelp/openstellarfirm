import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../shared/types";
import { chatFileName, chatMarkdown, hideKeys, stamp } from "./export";

const now = new Date("2026-11-19T12:00:00Z");

function msg(
  role: ChatMessage["role"],
  text: string,
  at: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return { id: `${role}-${at}`, role, text, at, ...extra };
}

describe("chatMarkdown", () => {
  it("writes names, times and both sides' words", () => {
    const md = chatMarkdown(
      "Trip planner",
      [
        msg("user", "Find me a train to Lyon.", "2026-11-19T09:05:00Z"),
        msg(
          "assistant",
          "Here are three:\n\n- 08:10\n- 09:40",
          "2026-11-19T09:06:00Z",
        ),
      ],
      { now, timeZone: "UTC" },
    );
    expect(md).toBe(
      [
        "# Chat with Trip planner",
        "",
        "Saved from OpenStellarFirm on 2026-11-19 12:00. 2 messages.",
        "",
        "---",
        "",
        "**You** · 2026-11-19 09:05",
        "",
        "Find me a train to Lyon.",
        "",
        "---",
        "",
        "**Trip planner** · 2026-11-19 09:06",
        "",
        "Here are three:\n\n- 08:10\n- 09:40",
        "",
      ].join("\n"),
    );
  });

  it("never writes the steps an assistant took", () => {
    const md = chatMarkdown(
      "Coder",
      [
        msg("assistant", "Done.", "2026-11-19T09:06:00Z", {
          steps: [
            { label: "Called a tool with token=abcdef0123456789", ok: true },
          ],
        }),
      ],
      { now, timeZone: "UTC" },
    );
    expect(md).not.toContain("Called a tool");
    expect(md).not.toContain("abcdef0123456789");
  });

  it("hides every saved key, and known shapes of keys", () => {
    const saved = "my-own-endpoint-key-123456";
    const md = chatMarkdown(
      "Coder",
      [
        msg(
          "user",
          `Use ${saved} and sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV and ghp_0123456789abcdefghijABCDEFGHIJ`,
          "2026-11-19T09:05:00Z",
        ),
        msg(
          "assistant",
          "Set api_key=supersecretvalue and send Bearer abcdefghijklmnopqrstuvwxyz",
          "2026-11-19T09:06:00Z",
        ),
      ],
      { now, timeZone: "UTC", hide: [saved] },
    );
    expect(md).not.toContain(saved);
    expect(md).not.toContain("sk-ant-api03");
    expect(md).not.toContain("ghp_0123");
    expect(md).not.toContain("supersecretvalue");
    expect(md).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(md).toContain("api_key=[key hidden]");
    expect(md).toContain("Bearer [key hidden]");
  });

  it("marks checks, updates and failed answers as the chat does", () => {
    const md = chatMarkdown(
      "Main",
      [
        msg("user", "Look for urgent mail.", "2026-11-19T08:00:00Z", {
          check: "request",
        }),
        msg("assistant", "Nothing urgent.", "2026-11-19T08:01:00Z", {
          check: "update",
        }),
        msg("assistant", "The model did not answer.", "2026-11-19T08:02:00Z", {
          failed: true,
        }),
      ],
      { now, timeZone: "UTC" },
    );
    expect(md).toContain("_Started a check at 2026-11-19 08:00._");
    expect(md).not.toContain("Look for urgent mail.");
    expect(md).toContain("**Main** · 2026-11-19 08:01 · check update");
    expect(md).toContain("**Main** · 2026-11-19 08:02 · could not answer");
    expect(md).toContain("2 messages.");
  });

  it("keeps a name from turning into Markdown", () => {
    const md = chatMarkdown("*Bold* [link](x)", [], { now, timeZone: "UTC" });
    expect(md.split("\n")[0]).toBe("# Chat with \\*Bold\\* \\[link\\](x)");
    expect(md).toContain("0 messages.");
  });
});

describe("hideKeys", () => {
  it("leaves ordinary words alone", () => {
    const text = "The password policy says eight letters. Ask for a token.";
    expect(hideKeys(text)).toBe(text);
  });

  it("ignores saved keys too short to be told from a word", () => {
    expect(hideKeys("a short one", ["short"])).toBe("a short one");
  });
});

describe("names and times", () => {
  it("offers a plain file name with the day", () => {
    const day = new Date(2026, 10, 19, 15, 0);
    expect(chatFileName("Trip planner", day)).toBe(
      "Trip planner chat 2026-11-19.md",
    );
    expect(chatFileName("Βοηθός / ../x", day)).toBe(
      "Βοηθός x chat 2026-11-19.md",
    );
    expect(chatFileName("///", day)).toBe("Assistant chat 2026-11-19.md");
  });

  it("writes a time in the zone it is given", () => {
    expect(stamp("2026-11-19T23:30:00Z", "UTC")).toBe("2026-11-19 23:30");
    expect(stamp("2026-11-19T23:30:00Z", "Europe/Athens")).toBe(
      "2026-11-20 01:30",
    );
    expect(stamp("not a time", "UTC")).toBe("");
  });
});
