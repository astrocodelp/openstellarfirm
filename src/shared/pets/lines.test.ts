import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_ALPHABET } from "./codes";
import {
  charWord,
  isPetLineId,
  PET_LINES,
  PET_ROLE_IDS,
  PET_ROLE_NAMES,
  petDoneTitleLine,
  petHelloLine,
  petLine,
  petRoleId,
  spokenRoleName,
} from "./lines";

const byId = new Map<string, string>(PET_LINES.map((l) => [l.id, l.text]));

describe("PET_LINES", () => {
  it("has the lines of the contract with their exact words", () => {
    const expected: Record<string, string> = {
      "setup-join":
        "Hi! To set me up, plug me into your computer and open OpenStellarFirm, or join my Wi-Fi network on your phone.",
      "setup-code":
        "Here is my confirm code. I will say it three times, slowly. Type it in OpenStellarFirm.",
      "setup-code-again": "Listen, here is the code again.",
      "setup-wifi-failed": "I couldn't join that Wi-Fi. Please try again.",
      "setup-refused":
        "OpenStellarFirm didn't accept that. Let's set me up again.",
      "setup-done": "All set. Hold my lime light and talk to me.",
      hello: "Hi! Hold my lime light and talk to me.",
      saved:
        "I'm offline, so I saved that. I'll send it when we're back online.",
      "memory-full":
        "My memory is full. I'll send your saved notes when we're back online.",
      "back-online": "I'm back online.",
      sent: "Sent your saved notes.",
      working: "Your team is on it. I'll tell you when it's ready.",
      done: "Your work is ready. Open OpenStellarFirm to see it.",
      "needs-approve":
        "One of your assistants is waiting for your Approve. Open OpenStellarFirm to decide.",
      stopped:
        "Your team stopped before the work was finished. Open OpenStellarFirm to see why.",
      refused: "Your rules stop that one. Open OpenStellarFirm to see why.",
      budget:
        "Your team reached a spending alert. Open OpenStellarFirm to see it.",
      message:
        "Your team has a message for you. Open OpenStellarFirm to read it.",
      "out-of-credits":
        "Your voice quota is used up. Check your speech plan, then try again.",
      "spending-limit":
        "Your spending limit stops me here. Open OpenStellarFirm to change it.",
      "no-access":
        "My voice key was refused. Open OpenStellarFirm to check it.",
      "battery-low": "My battery is low. Please plug me in.",
      charging: "Charging.",
      "mic-off": "My microphone is switched off.",
      busy: "OpenStellarFirm is busy right now. Please try again in a moment.",
      "didnt-catch": "Sorry, I didn't catch that.",
      paused: "I'm paused. Turn me back on in OpenStellarFirm.",
      disconnected:
        "I'm not connected to OpenStellarFirm anymore. Set me up again in OpenStellarFirm.",
      "notice-done": "finished. Open OpenStellarFirm to see it.",
      "notice-approval":
        "is waiting for your Approve. Open OpenStellarFirm to decide.",
      "notice-stopped":
        "stopped before it finished. Open OpenStellarFirm to see why.",
    };
    for (const [id, text] of Object.entries(expected)) {
      expect(byId.get(id), id).toBe(text);
    }
  });

  it("has every id once, 31 characters and every role", () => {
    const ids = PET_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith("char-"))).toHaveLength(31);
    expect(ids.filter((id) => id.startsWith("role-"))).toHaveLength(
      Object.keys(PET_ROLE_NAMES).length + 1,
    );
    expect(ids).toHaveLength(82);
  });

  it("keeps the order of the contract's table", () => {
    const ids = PET_LINES.map((l) => l.id);
    expect(ids.slice(0, 7)).toEqual([
      "setup-join",
      "setup-code",
      "setup-code-again",
      "setup-wifi-failed",
      "setup-refused",
      "setup-done",
      "char-A",
    ]);
    expect(ids[6 + 31]).toBe("hello");
    expect(ids.indexOf("notice-stopped")).toBe(
      ids.indexOf("role-developer") - 1,
    );
    expect(ids.at(-1)).toBe("role-assistant");
  });

  it("flags exactly the boot lines", () => {
    const boot = PET_LINES.filter((l) => l.boot).map((l) => l.id);
    const expected = [
      "setup-join",
      "setup-code",
      "setup-code-again",
      "setup-wifi-failed",
      "setup-refused",
      "setup-done",
      ...[...CODE_ALPHABET].map((c) => `char-${c}`),
      "saved",
      "memory-full",
      "battery-low",
      "charging",
      "mic-off",
      "busy",
      "didnt-catch",
      "disconnected",
    ];
    expect(boot).toEqual(expected);
  });

  it("holds no digit in any spoken text, and never the pet's name", () => {
    for (const line of PET_LINES) {
      expect(line.text, line.id).not.toMatch(/\d/);
      for (const name of ["Nova", "Zib", "Comet"]) {
        expect(line.text, line.id).not.toContain(name);
      }
    }
  });

  it("never says bot or robot", () => {
    for (const line of PET_LINES) {
      expect(line.text, line.id).not.toMatch(/\b(?:bot|robot)s?\b/i);
    }
  });

  it("is plain text: no em dash, no markup, no stray spaces", () => {
    for (const line of PET_LINES) {
      expect(line.text, line.id).not.toMatch(/[\u2013\u2014<>*_`#]/u);
      expect(line.text, line.id).toBe(line.text.trim());
      expect(line.text, line.id).not.toMatch(/\s{2,}/);
      expect(line.text.length, line.id).toBeGreaterThan(0);
    }
  });

  it("fits a voice pack entry: ids of 24 characters or fewer", () => {
    for (const line of PET_LINES) {
      expect(line.id.length, line.id).toBeLessThanOrEqual(24);
      expect(line.id, line.id).toMatch(/^[a-z][a-z-]*$|^char-[A-Z0-9]$/);
    }
  });

  it("looks a line up by id", () => {
    expect(petLine("done").text).toBe(
      "Your work is ready. Open OpenStellarFirm to see it.",
    );
    expect(petLine("char-K")).toEqual({ id: "char-K", text: "K", boot: true });
    expect(isPetLineId("done")).toBe(true);
    expect(isPetLineId("char-I")).toBe(false);
    expect(isPetLineId("constructor")).toBe(false);
    expect(isPetLineId(42)).toBe(false);
    expect(() => petLine("nope" as never)).toThrow(RangeError);
  });
});

describe("the sentences built around a name or a title", () => {
  it("says hello with the pet's name, with no digit, from the one place", () => {
    expect(petHelloLine("Nova")).toBe(
      "Hi, I'm Nova. Hold my lime light and talk to me.",
    );
    expect(petHelloLine("Nova")).not.toMatch(/\d/);
  });

  it("names the finished work in the pack's own sentence", () => {
    expect(petDoneTitleLine("bakery landing page")).toBe(
      "Your bakery landing page is ready. Open OpenStellarFirm to see it.",
    );
  });

  it("sends a pet that was forgotten to OpenStellarFirm, not to Settings", () => {
    expect(petLine("disconnected").text).toBe(
      "I'm not connected to OpenStellarFirm anymore. Set me up again in OpenStellarFirm.",
    );
    expect(petLine("disconnected").text).not.toMatch(/settings/i);
  });
});

describe("characters as words", () => {
  it("speaks digits as words and letters as themselves", () => {
    expect(charWord("2")).toBe("two");
    expect(charWord("9")).toBe("nine");
    expect(charWord("A")).toBe("A");
    expect(charWord("k")).toBe("K");
    for (const c of CODE_ALPHABET) {
      expect(charWord(c), c).toMatch(/^(?:[A-Z]|[a-z]+)$/);
    }
  });

  it("has a clip for every character of the alphabet and no other", () => {
    for (const c of CODE_ALPHABET) {
      expect(isPetLineId(`char-${c}`), c).toBe(true);
    }
    for (const c of "ILO01") {
      expect(isPetLineId(`char-${c}`), c).toBe(false);
    }
  });

  it("refuses anything else", () => {
    expect(() => charWord("-")).toThrow(RangeError);
    expect(() => charWord("")).toThrow(RangeError);
    expect(() => charWord("AB")).toThrow(RangeError);
  });
});

describe("roles", () => {
  // A role the pet has no clip for (an assistant the owner defined) has no clip on
  // purpose: no recorded line can name it, so the pet says the generic
  // "assistant". Leaving it out also keeps the firmware's role table and the
  // voice pack as they are.
  it("has a clip for every role it names, in the table's order", () => {
    expect(PET_ROLE_IDS).toEqual(Object.keys(PET_ROLE_NAMES));
    for (const id of PET_ROLE_IDS) {
      expect(PET_ROLE_NAMES[id], id).toBeTruthy();
      expect(isPetLineId(`role-${id}`), id).toBe(true);
    }
  });

  it("has no clip for a role of the owner's own, so the pet says the generic role", () => {
    expect(PET_ROLE_IDS).not.toContain("custom");
    expect(Object.hasOwn(PET_ROLE_NAMES, "custom")).toBe(false);
    expect(isPetLineId("role-custom")).toBe(false);
    expect(petRoleId("custom")).toBe("assistant");
    expect(spokenRoleName("custom")).toBe("assistant");
    expect(byId.get("role-assistant")).toBe("Your assistant");
  });

  it("says the role names of the contract", () => {
    expect(PET_ROLE_NAMES).toEqual({
      developer: "Coder",
      accountant: "Accountant",
      marketing: "Marketing assistant",
      legal: "Legal assistant",
      "product-owner": "Product owner",
      sales: "Sales assistant",
      "executive-assistant": "Executive assistant",
      support: "Support assistant",
      recruiting: "Recruiting assistant",
      eshop: "eShop assistant",
      dj: "DJ",
      copywriter: "Copywriter",
      teacher: "Professor's assistant",
      scientist: "Scientist",
      architect: "Architect",
      "mechanical-engineer": "Mechanical Engineer",
      designer: "Designer",
      journalist: "Journalist",
      agriculture: "Agronomist",
    });
    expect(byId.get("role-developer")).toBe("Your Coder");
    expect(byId.get("role-marketing")).toBe("Your Marketing assistant");
    expect(byId.get("role-assistant")).toBe("Your assistant");
  });

  it("resolves the names the protocol has always accepted", () => {
    expect(petRoleId("coder")).toBe("developer");
    expect(spokenRoleName("coder")).toBe("Coder");
    expect(petRoleId("reporter")).toBe("journalist");
    expect(spokenRoleName("fact-checker")).toBe("Journalist");
    expect(petRoleId("professors-assistant")).toBe("teacher");
  });

  it("resolves the persona ids of this app's personas folder", () => {
    const folder = join(import.meta.dirname, "../../../personas");
    const ids = readdirSync(folder)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      // Every persona has a role to say: a clip of its own, or the generic one.
      expect(petRoleId(id), id).toBeDefined();
    }
    expect(petRoleId("coder")).toBe("developer");
    expect(petRoleId("online-shop")).toBe("eshop");
    expect(petRoleId("tutor")).toBe("teacher");
    expect(petRoleId("researcher")).toBe("scientist");
    expect(petRoleId("writer")).toBe("copywriter");
    expect(petRoleId("accountant")).toBe("accountant");
  });

  it("calls an unknown role an assistant and a missing one nothing", () => {
    expect(spokenRoleName("future-persona")).toBe("assistant");
    expect(spokenRoleName(undefined)).toBe("assistant");
    expect(spokenRoleName("")).toBe("assistant");
    expect(petRoleId("future-persona")).toBe("assistant");
    expect(petRoleId(undefined)).toBeUndefined();
    expect(petRoleId(null)).toBeUndefined();
    expect(petRoleId("   ")).toBeUndefined();
  });

  it("does not take a property of Object for a role", () => {
    for (const word of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(petRoleId(word), word).toBe("assistant");
      expect(spokenRoleName(word), word).toBe("assistant");
    }
  });

  it("trims a role", () => {
    expect(petRoleId(" developer ")).toBe("developer");
  });
});
