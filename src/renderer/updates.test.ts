import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The update screens, read from the source (there is no page in the tests).
 * The choice is asked once, never ticked for the person, and no screen
 * builds an address: it sends only a link's name.
 */
const read = (name: string) =>
  readFileSync(join(import.meta.dirname, "src", name), "utf8");

describe("the update screens", () => {
  it("ask on the first run, from the saved switch, never ticked in advance", () => {
    const welcome = read("Welcome.tsx");
    expect(welcome).toContain("Tell me when a new version is out");
    expect(welcome).toContain("checked={checkUpdates}");
    expect(welcome).not.toMatch(/defaultChecked/);
    expect(read("App.tsx")).toContain(
      "checkUpdates={state.settings.checkUpdates}",
    );
  });

  it("open the download and the release by name, never by address", () => {
    for (const name of ["SettingsUpdates.tsx", "App.tsx"]) {
      const page = read(name);
      expect(page, name).toContain('api.openLink("download")');
      expect(page, name).toContain('api.openLink("release")');
      expect(page, name).not.toMatch(/releases\/download|github\.com/);
    }
  });

  it("keep the sidebar notice quiet, with the view's one lime button elsewhere", () => {
    expect(read("UpdateNotice.tsx")).not.toContain("btn-primary");
  });

  it("open Settings on Updates when the system notice is clicked", () => {
    expect(read("App.tsx")).toMatch(
      /onUpdateNews\([\s\S]{0,120}openSettings\(\{ section: "updates" \}\)/,
    );
  });
});
