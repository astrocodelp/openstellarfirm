import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadFile, linkUrl, REPO, releaseUrl } from "./links";
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
  shouldNotify,
  updateOutNotice,
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
      "https://github.com/astrocodelp/openstellarfirm",
    );
    expect(linkUrl("community")).toBe(
      "https://github.com/astrocodelp/openstellarfirm/discussions",
    );
    expect(linkUrl("ollama")).toBe("https://ollama.com/download");
    expect(linkUrl("lmstudio")).toBe("https://lmstudio.ai");
  });

  it("names the same repository as package.json", () => {
    // package.json is where the repository's address is changed; the app's
    // links (and the release scripts, which read package.json) follow it.
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.repository.url).toBe(`git+https://github.com/${REPO}.git`);
    expect(pkg.bugs.url).toBe(`https://github.com/${REPO}/issues`);
    expect(pkg.homepage).toBe(`https://github.com/${REPO}`);
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
      "https://github.com/astrocodelp/openstellarfirm/releases/tag/v1.2.3",
    );
    expect(() => releaseUrl("1.2.3/../../x")).toThrow();
    expect(() => releaseUrl("v1.2.3")).toThrow();
  });
});

describe("the download", () => {
  const releases = "https://github.com/astrocodelp/openstellarfirm/releases";
  const download = (platform: string, arch: string) =>
    linkUrl("download", "1.2.3", { platform, arch });

  it("opens this computer's file of the newest release", () => {
    expect(download("darwin", "arm64")).toBe(
      `${releases}/download/v1.2.3/OpenStellarFirm-1.2.3-mac-arm64.dmg`,
    );
    expect(download("darwin", "x64")).toBe(
      `${releases}/download/v1.2.3/OpenStellarFirm-1.2.3-mac-x64.dmg`,
    );
    expect(download("win32", "x64")).toBe(
      `${releases}/download/v1.2.3/OpenStellarFirm-1.2.3-win-x64.exe`,
    );
    // Windows on arm64 runs the x64 build.
    expect(download("win32", "arm64")).toBe(
      `${releases}/download/v1.2.3/OpenStellarFirm-1.2.3-win-x64.exe`,
    );
    expect(download("linux", "x64")).toBe(
      `${releases}/download/v1.2.3/OpenStellarFirm-1.2.3-linux-x64.AppImage`,
    );
  });

  it("opens the release page where there is no file for this computer", () => {
    for (const [platform, arch] of [
      ["linux", "arm64"],
      ["linux", "ia32"],
      ["darwin", "ia32"],
      ["win32", "ia32"],
      ["freebsd", "x64"],
    ] as const) {
      expect(downloadFile("1.2.3", { platform, arch })).toBeNull();
      expect(download(platform, arch)).toBe(`${releases}/tag/v1.2.3`);
    }
  });

  it("names the files as the build does", () => {
    const builder = readFileSync(
      join(import.meta.dirname, "../../electron-builder.yml"),
      "utf8",
    );
    expect(builder).toMatch(
      /artifactName: OpenStellarFirm-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/,
    );
    expect(builder).toMatch(
      /artifactName: OpenStellarFirm-\$\{version\}-linux-x64\.\$\{ext\}/,
    );
  });

  it("needs a known version and this computer, and is built from numbers only", () => {
    expect(() => linkUrl("download")).toThrow();
    expect(() => linkUrl("download", "1.2.3")).toThrow();
    expect(
      downloadFile("1.2.3/../x", { platform: "darwin", arch: "arm64" }),
    ).toBeNull();
    expect(
      downloadFile("v1.2.3", { platform: "darwin", arch: "arm64" }),
    ).toBeNull();
  });
});

describe("the notice for a new version", () => {
  const on = { checkUpdates: true };

  it("is told once for each version newer than the one running", () => {
    expect(shouldNotify(on, "0.2.0", "0.1.0")).toBe(true);
    expect(
      shouldNotify({ ...on, notifiedVersion: "0.2.0" }, "0.2.0", "0.1.0"),
    ).toBe(false);
    expect(
      shouldNotify({ ...on, notifiedVersion: "0.2.0" }, "0.3.0", "0.1.0"),
    ).toBe(true);
    expect(shouldNotify(on, "0.1.0", "0.1.0")).toBe(false);
  });

  it("stays quiet when checks or notices are off, or the version was dismissed", () => {
    expect(shouldNotify({}, "0.2.0", "0.1.0")).toBe(false);
    expect(shouldNotify({ ...on, updateNotify: false }, "0.2.0", "0.1.0")).toBe(
      false,
    );
    expect(
      shouldNotify({ ...on, dismissedVersion: "0.2.0" }, "0.2.0", "0.1.0"),
    ).toBe(false);
    expect(shouldNotify(on, "0.2.0 now", "0.1.0")).toBe(false);
  });

  it("says the version in plain words, built from the numbers only", () => {
    expect(updateOutNotice("0.2.0")).toEqual({
      title: "OpenStellarFirm 0.2.0 is out",
      body: "Open it to download the new version.",
    });
    expect(() => updateOutNotice("0.2.0 <b>")).toThrow();
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
