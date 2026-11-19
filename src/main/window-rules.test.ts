import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { allowWindowRequest, type WindowRequestRules } from "./window-rules";

const root = "/opt/app/renderer";
const installed: WindowRequestRules = {
  pageUrl: pathToFileURL(`${root}/index.html`).href,
  devUrl: undefined,
  packaged: true,
};
const source: WindowRequestRules = {
  pageUrl: installed.pageUrl,
  devUrl: "http://localhost:5173/",
  packaged: false,
};

describe("allowWindowRequest", () => {
  it("lets an installed app load its own files only", () => {
    for (const url of [
      installed.pageUrl,
      pathToFileURL(`${root}/assets/index-abc.js`).href,
      pathToFileURL(`${root}/assets/Geist.woff2`).href,
      "data:image/svg+xml,%3Csvg%3E",
      "blob:file:///1234",
    ]) {
      expect(allowWindowRequest(url, installed), url).toBe(true);
    }
  });

  it("cancels everything else", () => {
    for (const url of [
      "https://example.com/a.png",
      "http://localhost:5173/",
      "ws://localhost:5173/",
      "devtools://devtools/bundled/x.js",
      "file:///etc/passwd",
      pathToFileURL("/opt/app/other/secret.txt").href,
      pathToFileURL(`${root}/../keys.json`).href,
      "file:///opt/app/renderer/../keys.json",
      "ftp://example.com/",
      "chrome://gpu",
      "not a url",
    ]) {
      expect(allowWindowRequest(url, installed), url).toBe(false);
    }
  });

  it("lets a build from source reach its dev server and devtools, on that host only", () => {
    expect(
      allowWindowRequest("http://localhost:5173/src/main.tsx", source),
    ).toBe(true);
    expect(allowWindowRequest("ws://localhost:5173/", source)).toBe(true);
    expect(allowWindowRequest("devtools://devtools/bundled/x.js", source)).toBe(
      true,
    );
    expect(allowWindowRequest("http://localhost:9999/", source)).toBe(false);
    expect(allowWindowRequest("https://example.com/", source)).toBe(false);
  });

  it("never reaches a dev server when installed, even if one is named", () => {
    const sneaky = { ...installed, devUrl: "http://localhost:5173/" };
    expect(allowWindowRequest("http://localhost:5173/", sneaky)).toBe(false);
  });
});
