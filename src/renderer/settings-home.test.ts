import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shortcuts } from "../shared/accessibility";
import { filterPalette, paletteItems } from "./src/palette-items";
import {
  escapeLeavesSettings,
  FIRST_SETTINGS_PAGE,
  isSettingsPage,
  pageOfSection,
  SETTINGS_PAGES,
  SETTINGS_SECTIONS,
  sectionStandsAlone,
  settingsRoute,
} from "./src/settings-sections";

/**
 * Settings is the one place the app is set up: a list of pages on its own
 * left side, and the sidebar keeps the assistants. The routes into it are
 * pure, so they are run here; the rest is read from the source.
 */

const dir = join(import.meta.dirname, "src");
const source = (name: string) => readFileSync(join(dir, name), "utf8");

describe("the Settings pages", () => {
  it("put every section on exactly one page", () => {
    const placed = SETTINGS_PAGES.flatMap((p) => [...p.sections]);
    expect([...placed].sort()).toEqual(
      SETTINGS_SECTIONS.map((s) => s.id).sort(),
    );
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("list the screens that used to sit in the sidebar", () => {
    const titles = SETTINGS_PAGES.map((p) => p.title);
    for (const title of [
      "General",
      "Models",
      "Connections",
      "Mail",
      "Accessibility",
      "Move or back up",
    ])
      expect(titles).toContain(title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("give a section that is its whole page no second heading", () => {
    expect(sectionStandsAlone("accessibility")).toBe(true);
    expect(sectionStandsAlone("reading")).toBe(true);
    expect(sectionStandsAlone("appearance")).toBe(false);
    expect(sectionStandsAlone("updates")).toBe(false);
  });

  it("know a page's id from anything else read back", () => {
    expect(isSettingsPage("models")).toBe(true);
    expect(isSettingsPage("settings")).toBe(false);
    expect(isSettingsPage(null)).toBe(false);
  });
});

describe("a way into Settings", () => {
  it("opens a section on its own page", () => {
    expect(settingsRoute({ section: "approvals" }, "mail")).toEqual({
      page: "general",
      section: "approvals",
    });
    expect(pageOfSection("about")).toBe("updates");
  });

  it("opens the page it names", () => {
    expect(settingsRoute({ page: "models" }, "general")).toEqual({
      page: "models",
    });
  });

  it("opens where Settings was left, or on the first page", () => {
    expect(settingsRoute({}, "backup")).toEqual({ page: "backup" });
    expect(settingsRoute({}, null)).toEqual({ page: FIRST_SETTINGS_PAGE });
  });

  it("is a page of Settings for every place that opened a screen", () => {
    const app = source("App.tsx");
    expect(app).toContain('onModels={() => openSettings({ page: "models" })}');
    expect(app).not.toMatch(
      /setView\(\{ name: "(models|connections|mail|backup)" \}\)/,
    );
    const settings = source("Settings.tsx");
    expect(settings).toContain('onMail={() => onPage("mail", "link")}');
    expect(settings).toContain('onBackup={() => onPage("backup", "link")}');
  });

  it("from Find anything, leads every page and section to its place", () => {
    const items = paletteItems({
      assistants: [],
      connections: [],
      mailAccounts: [],
    });
    const models = filterPalette(items, "models").find(
      (i) => i.label === "Models",
    );
    expect(models?.target).toEqual({ kind: "settings", page: "models" });
    const theme = filterPalette(items, "theme")[0];
    expect(theme?.label).toBe("Appearance");
    expect(theme?.detail).toBe("Settings, General");
    expect(theme?.target).toEqual({ kind: "settings", section: "appearance" });
    // A section that is its whole page is found once, as the page.
    const access = filterPalette(items, "accessibility").map((i) => i.label);
    expect(access.filter((l) => l === "Accessibility")).toHaveLength(1);
    expect(filterPalette(items, "contrast")[0]?.target).toEqual({
      kind: "settings",
      page: "accessibility",
    });
  });
});

describe("Escape on a Settings page", () => {
  const press = (
    target: { tag: string; type?: string; inDialog?: boolean },
    more: { defaultPrevented?: boolean; isComposing?: boolean } = {},
  ) =>
    escapeLeavesSettings({
      key: "Escape",
      defaultPrevented: more.defaultPrevented ?? false,
      isComposing: more.isComposing ?? false,
      target: { inDialog: false, ...target },
    });

  it("goes back to the chats from a button, a page or a tick box", () => {
    expect(press({ tag: "BUTTON" })).toBe(true);
    expect(press({ tag: "BODY" })).toBe(true);
    expect(press({ tag: "INPUT", type: "radio" })).toBe(true);
    expect(press({ tag: "INPUT", type: "checkbox" })).toBe(true);
  });

  it("never leaves from a field, a question or a dialog", () => {
    expect(press({ tag: "INPUT", type: "text" })).toBe(false);
    expect(press({ tag: "INPUT" })).toBe(false);
    expect(press({ tag: "TEXTAREA" })).toBe(false);
    expect(press({ tag: "SELECT" })).toBe(false);
    expect(press({ tag: "BUTTON", inDialog: true })).toBe(false);
    expect(press({ tag: "BUTTON" }, { defaultPrevented: true })).toBe(false);
    expect(press({ tag: "BUTTON" }, { isComposing: true })).toBe(false);
    expect(
      escapeLeavesSettings({
        key: "Enter",
        defaultPrevented: false,
        target: { tag: "BUTTON", inDialog: false },
      }),
    ).toBe(false);
  });

  it("is in the shortcuts list, with the key that opens Settings", () => {
    const all = shortcuts(false, "enter").flatMap((g) => g.items);
    expect(all).toContainEqual({ keys: ["Ctrl", ","], does: "Open Settings" });
    expect(all.some((s) => /back to the chats/i.test(s.does))).toBe(true);
  });
});

describe("the sidebar", () => {
  const sidebar = source("Sidebar.tsx");

  it("ends in one row, Settings, and lists no screen of its own", () => {
    for (const gone of ["onModels", "onConnections", "onMail", "onBackup"])
      expect(sidebar).not.toContain(gone);
    expect(sidebar).not.toContain('className="sidebar-nav"');
    const foot = sidebar.slice(sidebar.indexOf('className="sidebar-foot"'));
    expect(foot.match(/<button\b/g)).toHaveLength(1);
    expect(foot).toContain('aria-current={props.settingsOpen ? "page"');
  });

  it("keeps Settings' own list as plain buttons marked with the open page", () => {
    const home = source("Settings.tsx");
    expect(home).toMatch(/<nav className="settings-nav" aria-label="[^"]+"/);
    expect(home).toContain('aria-current={p.id === page ? "page" : undefined}');
    // No tabs: plain buttons in order, reached with Tab.
    expect(home).not.toMatch(/role="tab/);
  });
});

describe("the Settings layout", () => {
  const css = source("styles.css");

  it("never moves the list when the page changes, and never animates it", () => {
    // The page keeps room for a scrollbar, and the list keeps its width.
    expect(css).toMatch(/\n\.screen \{[^}]*scrollbar-gutter: stable/);
    expect(css).toMatch(/\n\.settings-nav \{[^}]*flex: 0 0 \d/);
    // A new page is shown at once: the pane only rises when Settings opens.
    expect(css).not.toMatch(/\.settings-home > \.screen[^{]*\{[^}]*animation/);
  });
});
