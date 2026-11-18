import { describe, expect, it } from "vitest";
import { linkUrl, releaseUrl } from "./links";
import {
  cleanSendKey,
  cleanTextSize,
  sendHint,
  sendsMessage,
} from "./preferences";
import {
  availableUpdate,
  cleanVersion,
  compareVersions,
  isNewer,
  versionOfTag,
} from "./update";

const key = (over: Partial<Parameters<typeof sendsMessage>[1]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  ...over,
});

describe("versions", () => {
  it("reads only plain release tags", () => {
    expect(versionOfTag("v1.2.3")).toBe("1.2.3");
    for (const bad of [
      "1.2.3",
      "v1.2",
      "v1.2.3-beta.1",
      "v1.2.3/../../x",
      "v1.0.0 https://evil.example",
      "v1.2.3\n",
      "v99999999.0.0",
      "",
      null,
      42,
      { toString: () => "v1.2.3" },
    ])
      expect(versionOfTag(bad), String(bad)).toBeNull();
  });

  it("compares numbers, not text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.9.9", "0.10.0")).toBe(false);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("1.0.1", "1.0.0")).toBe(true);
    expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("reads the app's own version with a suffix, and refuses nonsense", () => {
    expect(isNewer("0.2.0", "0.1.0-dev")).toBe(true);
    expect(compareVersions("1.0.0", "unknown")).toBeNull();
    expect(isNewer("1.0.0", "unknown")).toBe(false);
  });

  it("announces only a newer version that was not dismissed", () => {
    expect(availableUpdate({ newestVersion: "0.2.0" }, "0.1.0")).toBe("0.2.0");
    expect(availableUpdate({ newestVersion: "0.2.0" }, "0.2.0")).toBeNull();
    expect(availableUpdate({ newestVersion: "0.2.0" }, "0.3.0")).toBeNull();
    expect(
      availableUpdate(
        { newestVersion: "0.2.0", dismissedVersion: "0.2.0" },
        "0.1.0",
      ),
    ).toBeNull();
    expect(
      availableUpdate(
        { newestVersion: "0.3.0", dismissedVersion: "0.2.0" },
        "0.1.0",
      ),
    ).toBe("0.3.0");
    expect(availableUpdate({ newestVersion: "v1/../x" }, "0.1.0")).toBeNull();
    expect(cleanVersion("1.2.3 ")).toBeNull();
  });
});

describe("fixed links", () => {
  it("maps a name to a fixed address", () => {
    expect(linkUrl("source")).toBe(
      "https://github.com/astrocodelp/worker-bot-open-source",
    );
    expect(linkUrl("community")).toBe(
      "https://github.com/astrocodelp/worker-bot-open-source/discussions",
    );
  });

  it("refuses a name it does not know, and an address", () => {
    for (const bad of [
      "https://evil.example",
      "constructor",
      "__proto__",
      "",
      undefined,
      null,
      {},
    ])
      expect(() => linkUrl(bad), String(bad)).toThrow();
  });

  it("opens a release only for a version that is known, in one fixed shape", () => {
    expect(() => linkUrl("release")).toThrow();
    expect(linkUrl("release", "1.2.3")).toBe(
      "https://github.com/astrocodelp/worker-bot-open-source/releases/tag/v1.2.3",
    );
    expect(() => releaseUrl("1.2.3/../../x")).toThrow();
    expect(() => releaseUrl("v1.2.3")).toThrow();
  });
});

describe("chat preferences", () => {
  it("reads unknown values as the defaults", () => {
    expect(cleanTextSize("huge")).toBe("default");
    expect(cleanTextSize("large")).toBe("large");
    expect(cleanSendKey("ctrl")).toBe("enter");
    expect(cleanSendKey("mod-enter")).toBe("mod-enter");
  });

  it("sends with the chosen key and makes a line with the other", () => {
    expect(sendsMessage("enter", key())).toBe(true);
    expect(sendsMessage("enter", key({ shiftKey: true }))).toBe(false);
    expect(sendsMessage("enter", key({ ctrlKey: true }))).toBe(false);
    expect(sendsMessage("mod-enter", key())).toBe(false);
    expect(sendsMessage("mod-enter", key({ ctrlKey: true }))).toBe(true);
    expect(sendsMessage("mod-enter", key({ metaKey: true }))).toBe(true);
    expect(sendsMessage("enter", key({ key: "a" }))).toBe(false);
  });

  it("words the hint for the choice and the computer", () => {
    expect(sendHint("enter", true)).toMatch(/^Enter sends/);
    expect(sendHint("mod-enter", true)).toMatch(/^Cmd\+Enter sends/);
    expect(sendHint("mod-enter", false)).toMatch(/^Ctrl\+Enter sends/);
  });
});
