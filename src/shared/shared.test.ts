import { describe, expect, it } from "vitest";
import { PRESETS } from "./catalog";
import { checkEndpoint, isLocalEndpoint } from "./endpoint";
import { systemPrompt } from "./prompt";

describe("checkEndpoint", () => {
  it("takes https and trims the trailing slash", () => {
    expect(checkEndpoint(" https://models.example.com/v1/ ")).toBe(
      "https://models.example.com/v1",
    );
  });

  it("allows plain http only on this computer", () => {
    expect(checkEndpoint("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
    expect(checkEndpoint("http://127.0.0.1:1234/v1")).toBe(
      "http://127.0.0.1:1234/v1",
    );
    expect(() => checkEndpoint("http://models.example.com/v1")).toThrow(
      /https/,
    );
  });

  it("refuses a sign-in, a query or another scheme in the address", () => {
    expect(() =>
      checkEndpoint("https://user:secret@models.example.com/v1"),
    ).toThrow(/sign-in/);
    expect(() =>
      checkEndpoint("https://models.example.com/v1?key=secret"),
    ).toThrow(/question mark/);
    expect(() => checkEndpoint("file:///etc/passwd")).toThrow();
    expect(() => checkEndpoint("not an address")).toThrow(/web address/);
  });

  it("checks every preset's own address", () => {
    for (const preset of PRESETS) {
      if (preset.id === "custom") continue;
      expect(checkEndpoint(preset.baseUrl)).toBe(preset.baseUrl);
      expect(isLocalEndpoint(preset.baseUrl)).toBe(preset.local);
    }
  });
});

describe("systemPrompt", () => {
  it("carries the person's brief and the picked skills' guidance", () => {
    const prompt = systemPrompt({
      name: "Scout",
      brief: "Help me plan trips.",
      skills: ["research"],
    });
    expect(prompt).toContain("You are Scout");
    expect(prompt).toContain("Help me plan trips.");
    expect(prompt).toContain("say where it comes from");
  });

  it("always says the assistant has no tools, so it cannot claim an action", () => {
    const prompt = systemPrompt({ name: "Scout", brief: "", skills: [] });
    expect(prompt).toContain("You can only talk in this version");
    expect(prompt).toContain("Never say you did something you did not do");
  });
});
