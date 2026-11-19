import { describe, expect, it } from "vitest";
import { PET_LINES, petLine } from "./lines";
import { noticeClips, noticeLine } from "./notice";
import { NOTICE_KINDS } from "./protocol";

const clipText = (ids: readonly string[] | null): string =>
  (ids ?? [])
    .map((id) => PET_LINES.find((l) => l.id === id)?.text ?? "?")
    .join(" ");

describe("noticeLine", () => {
  it("names the work on a done notice with a title", () => {
    expect(noticeLine("done", "developer", "bakery landing page")).toBe(
      "Your bakery landing page is ready. Open OpenStellarFirm to see it.",
    );
    expect(noticeLine("done", undefined, "Bakery landing page")).toBe(
      "Your bakery landing page is ready. Open OpenStellarFirm to see it.",
    );
  });

  it("cleans the title itself, so a caller can pass the raw one", () => {
    expect(
      noticeLine(
        "done",
        "developer",
        'The "Bakery" site for $12.99 at shop.example.com',
      ),
    ).toBe("Your bakery site for at is ready. Open OpenStellarFirm to see it.");
  });

  it("names the role on a done notice with no usable title", () => {
    const line = "Your Coder finished. Open OpenStellarFirm to see it.";
    expect(noticeLine("done", "developer")).toBe(line);
    expect(noticeLine("done", "coder")).toBe(line);
    expect(noticeLine("done", "developer", "")).toBe(line);
    expect(noticeLine("done", "developer", "$50 12.99 EUR")).toBe(line);
  });

  it("uses the done line with no title and no role", () => {
    expect(noticeLine("done")).toBe(petLine("done").text);
    expect(noticeLine("done", null, null)).toBe(petLine("done").text);
    expect(noticeLine("done", "  ")).toBe(petLine("done").text);
  });

  it("says Your assistant for a role the pet has no clip for", () => {
    expect(noticeLine("done", "future-persona")).toBe(
      "Your assistant finished. Open OpenStellarFirm to see it.",
    );
    expect(noticeLine("approval", "future-persona")).toBe(
      "Your assistant is waiting for your Approve. Open OpenStellarFirm to decide.",
    );
  });

  it("names only the role on an approval or a stopped notice", () => {
    expect(noticeLine("approval", "marketing")).toBe(
      "Your Marketing assistant is waiting for your Approve. Open OpenStellarFirm to decide.",
    );
    expect(noticeLine("stopped", "legal")).toBe(
      "Your Legal assistant stopped before it finished. Open OpenStellarFirm to see why.",
    );
    expect(noticeLine("approval")).toBe(petLine("needs-approve").text);
    expect(noticeLine("stopped")).toBe(petLine("stopped").text);
  });

  it("never puts the title in an approval or a stopped line", () => {
    const title = "Pay the invoice for the bakery";
    for (const kind of ["approval", "stopped"] as const) {
      for (const role of [undefined, "developer", "accountant"]) {
        const line = noticeLine(kind, role, title);
        expect(line, `${kind} ${role}`).not.toMatch(/invoice|bakery|pay/i);
        expect(line).toBe(noticeLine(kind, role));
      }
    }
    expect(noticeLine("budget", "developer", title)).toBe(
      petLine("budget").text,
    );
  });

  it("carries no digit in any line but a done title", () => {
    for (const kind of NOTICE_KINDS) {
      for (const role of [
        undefined,
        "developer",
        "mechanical-engineer",
        "nope",
      ]) {
        if (kind === "done") {
          continue;
        }
        const line = noticeLine(kind, role, "Q3 plan 2026 12.99");
        expect(line, `${kind} ${role}`).not.toMatch(/\d/);
      }
    }
    // Without a title even a done notice has none.
    expect(noticeLine("done", "developer")).not.toMatch(/\d/);
  });

  it("answers budget and message with their pack lines and a setting with nothing", () => {
    expect(noticeLine("budget")).toBe(petLine("budget").text);
    expect(noticeLine("message")).toBe(petLine("message").text);
    expect(noticeLine("settings")).toBe("");
    expect(noticeLine("settings", "developer", "A title")).toBe("");
  });

  it("keeps a short digit of a title, as the contract allows", () => {
    expect(noticeLine("done", undefined, "Q3 report")).toBe(
      "Your Q3 report is ready. Open OpenStellarFirm to see it.",
    );
  });
});

describe("noticeClips", () => {
  it("fetches a titled done notice and a message spoken", () => {
    expect(noticeClips("done", "developer", true)).toBeNull();
    expect(noticeClips("done", undefined, true)).toBeNull();
    expect(noticeClips("message")).toBeNull();
    expect(noticeClips("message", "developer", true)).toBeNull();
  });

  it("plays the role clip and the suffix for a done notice without a title", () => {
    expect(noticeClips("done", "developer", false)).toEqual([
      "role-developer",
      "notice-done",
    ]);
    expect(noticeClips("done", "coder", false)).toEqual([
      "role-developer",
      "notice-done",
    ]);
    expect(noticeClips("done", "future-persona", false)).toEqual([
      "role-assistant",
      "notice-done",
    ]);
    expect(noticeClips("done", undefined, false)).toEqual(["done"]);
    expect(noticeClips("done")).toEqual(["done"]);
  });

  it("plays the role clip and the suffix for approval and stopped", () => {
    expect(noticeClips("approval", "legal", false)).toEqual([
      "role-legal",
      "notice-approval",
    ]);
    expect(noticeClips("approval", undefined, false)).toEqual([
      "needs-approve",
    ]);
    expect(noticeClips("stopped", "sales", false)).toEqual([
      "role-sales",
      "notice-stopped",
    ]);
    expect(noticeClips("stopped", undefined, false)).toEqual(["stopped"]);
  });

  it("ignores a title for approval and stopped, as the line does", () => {
    expect(noticeClips("approval", "legal", true)).toEqual(
      noticeClips("approval", "legal", false),
    );
    expect(noticeClips("stopped", undefined, true)).toEqual(["stopped"]);
  });

  it("plays the budget line and nothing for a setting", () => {
    expect(noticeClips("budget", "developer", true)).toEqual(["budget"]);
    expect(noticeClips("settings")).toEqual([]);
  });

  it("says the same words as the line, for every kind and role", () => {
    for (const kind of NOTICE_KINDS) {
      for (const role of [
        undefined,
        "developer",
        "coder",
        "accountant",
        "mechanical-engineer",
        "future-persona",
      ]) {
        const clips = noticeClips(kind, role, false);
        if (clips === null) {
          continue;
        }
        expect(clipText(clips), `${kind} ${role}`).toBe(noticeLine(kind, role));
      }
    }
  });

  it("only plays clips that are in the pack", () => {
    const ids = new Set<string>(PET_LINES.map((l) => l.id));
    for (const kind of NOTICE_KINDS) {
      for (const role of [undefined, "developer", "nope"]) {
        for (const hasTitle of [false, true]) {
          for (const clip of noticeClips(kind, role, hasTitle) ?? []) {
            expect(ids.has(clip), clip).toBe(true);
          }
        }
      }
    }
  });
});
