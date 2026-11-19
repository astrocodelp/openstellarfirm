import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { menuTemplate, REFUSED_SWITCHES, refusedLaunch } from "./app-menu";

/** Every role and label in a menu, submenus included. */
function walk(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(item.label ? [item.label] : []),
    ...(Array.isArray(item.submenu) ? walk(item.submenu) : []),
  ]);
}

const index = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
const reader = readFileSync(join(import.meta.dirname, "reader.ts"), "utf8");

describe("the app's menu", () => {
  it("has no developer tools and no reload in an installed app", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const roles = walk(menuTemplate(platform, true));
      expect(roles, platform).not.toContain("toggleDevTools");
      expect(roles, platform).not.toContain("reload");
      expect(roles, platform).not.toContain("forceReload");
      // Edit, zoom and the window's own items stay.
      for (const kept of ["editMenu", "zoomIn", "resetZoom", "windowMenu"])
        expect(roles, `${platform} ${kept}`).toContain(kept);
      // Electron's Help menu only links to Electron's own pages.
      expect(roles).not.toContain("help");
    }
  });

  it("keeps the developer tools when run from source", () => {
    expect(walk(menuTemplate("linux", false))).toContain("toggleDevTools");
  });

  it("is set by the app, and every window turns the tools and spelling off", () => {
    expect(index).toMatch(
      /Menu\.setApplicationMenu\(\s*Menu\.buildFromTemplate/,
    );
    for (const source of [index, reader]) {
      expect(source).toContain("devTools: !app.isPackaged");
      expect(source).toContain("spellcheck: false");
    }
    // The menu still hides until Alt on Linux and Windows.
    expect(index).toContain('autoHideMenuBar: process.platform !== "darwin"');
  });
});

describe("starting an installed app", () => {
  const none = () => false;

  it("refuses a debugging port or pipe and every inspector switch", () => {
    for (const name of [
      "remote-debugging-port",
      "remote-debugging-pipe",
      "inspect",
      "inspect-brk",
      "inspect-port",
    ]) {
      expect(REFUSED_SWITCHES, name).toContain(name);
      expect(
        refusedLaunch(true, (asked) => asked === name, ["app"]),
        name,
      ).toBe(true);
    }
    // Spellings Chromium does not parse are read from the command line.
    for (const arg of [
      "--inspect=9229",
      "--inspect-brk",
      "--remote-debugging-pipe",
      "--REMOTE-DEBUGGING-PORT=0",
      "-inspect",
    ])
      expect(refusedLaunch(true, none, ["app", arg]), arg).toBe(true);
  });

  it("starts with ordinary arguments, and runs from source as it likes", () => {
    expect(refusedLaunch(true, none, ["app", "--lang=en", "file.txt"])).toBe(
      false,
    );
    expect(refusedLaunch(false, () => true, ["app", "--inspect"])).toBe(false);
  });
});
