import { describe, expect, it } from "vitest";
import { carryFlags, newSeen, privateKind, seenKind } from "./seen";

describe("what an answer has seen", () => {
  it("names nothing before anything was read", () => {
    expect(seenKind(newSeen())).toBe(false);
    expect(privateKind(newSeen())).toBe(false);
  });

  it("counts a connection's answer and another assistant's as private", () => {
    for (const flag of ["files", "screen", "mail", "connection", "assistant"]) {
      const seen = { ...newSeen(), [flag]: true };
      expect(seenKind(seen), flag).toBe(flag);
      expect(privateKind(seen), flag).toBe(flag);
    }
  });

  it("counts a web page and its own computer as outside text, not private", () => {
    for (const flag of ["web", "computer"]) {
      const seen = { ...newSeen(), [flag]: true };
      expect(seenKind(seen), flag).toBe(flag);
      expect(privateKind(seen), flag).toBe(false);
    }
  });

  it("names the strongest reason, and leaves out what it is told to", () => {
    const seen = { ...newSeen(), web: true, mail: true, connection: true };
    expect(seenKind(seen)).toBe("mail");
    expect(seenKind(seen, ["mail"])).toBe("connection");
    expect(seenKind(seen, ["mail", "connection"])).toBe("web");
    expect(privateKind(seen, ["mail", "connection"])).toBe(false);
  });

  it("counts a flag it does not know yet as private, and never the picture", () => {
    const later = { ...newSeen(), calendar: true };
    expect(seenKind(later)).toBe("other");
    expect(privateKind(later)).toBe("other");
    const picture = {
      ...newSeen(),
      picture: { mediaType: "image/png", data: "" },
    };
    expect(seenKind(picture)).toBe(false);
  });

  it("carries every flag into another answer, and never takes one back", () => {
    const into = newSeen();
    carryFlags({ ...newSeen(), connection: true, assistant: false }, into);
    expect(into.connection).toBe(true);
    expect(into.assistant).toBeUndefined();
  });
});
