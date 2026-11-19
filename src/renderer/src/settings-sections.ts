/**
 * Settings is the one place where the app is set up. It is a set of pages,
 * listed on its own left side, and a page is a set of sections. The pages, the
 * sections' headings and Find anything all read these two lists, so a new page
 * or section can always be found. Pure, so the routes can be tested without a
 * page.
 */

/** The sections, in the order they stand on their pages. */
export const SETTINGS_SECTIONS = [
  {
    id: "appearance",
    title: "Appearance",
    keywords: "theme dark light text size bigger",
  },
  {
    id: "chat",
    title: "Chat",
    keywords: "send enter key new line message box",
  },
  {
    id: "main",
    title: "Main assistant",
    keywords: "check on its own schedule notify update look for",
  },
  {
    id: "approvals",
    title: "Approvals",
    keywords: "always allow sites reads forget ask",
  },
  { id: "cloud", title: "StellarFirm cloud", keywords: "card sidebar" },
  { id: "data", title: "Your data", keywords: "data folder delete chats" },
  {
    id: "accessibility",
    title: "Accessibility",
    keywords:
      "contrast motion animation focus ring underline links read aloud speech voice larger targets screen reader keyboard",
  },
  {
    id: "reading",
    title: "Reading other languages",
    keywords: "ocr scan scanned picture pdf language download text",
  },
  { id: "updates", title: "Updates", keywords: "version check new release" },
  { id: "about", title: "About", keywords: "version licence license" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/**
 * The pages, in the order Settings lists them. `group` starts a new block in
 * the list: what the app is like, what the assistants work with, how the app
 * reads and is read, then the app's own data and version. A page with no
 * sections is a screen of its own (Models, Connections, Mail, Move or back up).
 */
export const SETTINGS_PAGES = [
  {
    id: "general",
    title: "General",
    group: 1,
    keywords: "preferences options",
    sections: ["appearance", "chat", "main", "approvals", "cloud", "data"],
  },
  {
    id: "models",
    title: "Models",
    group: 2,
    keywords: "model source key ollama lm studio openai claude local",
    sections: [],
  },
  {
    id: "connections",
    title: "Connections",
    group: 2,
    keywords: "mcp server tools services github composio link",
    sections: [],
  },
  {
    id: "mail",
    title: "Mail",
    group: 2,
    keywords: "inbox email mailbox imap",
    sections: [],
  },
  {
    id: "deskpets",
    title: "Desk pets",
    group: 2,
    keywords:
      "pet desk figure nova zib comet usb cable wifi voice elevenlabs speak microphone arduino",
    sections: [],
  },
  {
    id: "accessibility",
    title: "Accessibility",
    group: 3,
    keywords: "",
    sections: ["accessibility"],
  },
  {
    id: "reading",
    title: "Reading other languages",
    group: 3,
    keywords: "",
    sections: ["reading"],
  },
  {
    id: "backup",
    title: "Move or back up",
    group: 4,
    keywords: "backup export import another computer file",
    sections: [],
  },
  {
    id: "updates",
    title: "Updates and About",
    group: 4,
    keywords: "",
    sections: ["updates", "about"],
  },
] as const satisfies readonly {
  id: string;
  title: string;
  group: number;
  keywords: string;
  sections: readonly SettingsSectionId[];
}[];

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

/** Where Settings opens the first time. */
export const FIRST_SETTINGS_PAGE: SettingsPageId = "general";

/** A section's heading, as the page shows it. */
export function sectionTitle(id: SettingsSectionId): string {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`No settings section ${id}`);
  return found.title;
}

/** A page's name, in the list and as its heading. */
export function pageTitle(id: SettingsPageId): string {
  const found = SETTINGS_PAGES.find((p) => p.id === id);
  if (!found) throw new Error(`No settings page ${id}`);
  return found.title;
}

/** The page a section stands on. */
export function pageOfSection(id: SettingsSectionId): SettingsPageId {
  const found = SETTINGS_PAGES.find((p) =>
    (p.sections as readonly string[]).includes(id),
  );
  if (!found) throw new Error(`Settings section ${id} is on no page`);
  return found.id;
}

/**
 * True when a section is its page and nothing else, under the same name
 * (Accessibility). Its page's heading names it, so it has no heading of its
 * own: two headings saying the same word, one under the other, say nothing.
 */
export function sectionStandsAlone(id: SettingsSectionId): boolean {
  const page = SETTINGS_PAGES.find((p) => p.id === pageOfSection(id));
  return page?.sections.length === 1 && page.title === sectionTitle(id);
}

/** True for a page's id, such as one read back from this computer. */
export function isSettingsPage(value: unknown): value is SettingsPageId {
  return SETTINGS_PAGES.some((p) => p.id === value);
}

/** Where a way into Settings leads: a page, and maybe a section on it. */
export interface SettingsRoute {
  page: SettingsPageId;
  section?: SettingsSectionId;
}

/**
 * The page and section a way into Settings opens. A section decides its own
 * page; a page is taken as it is; with neither, Settings opens where it was
 * left, or on its first page.
 */
export function settingsRoute(
  to: { page?: SettingsPageId; section?: SettingsSectionId },
  last: SettingsPageId | null,
): SettingsRoute {
  if (to.section)
    return { page: pageOfSection(to.section), section: to.section };
  return { page: to.page ?? last ?? FIRST_SETTINGS_PAGE };
}

/** Kinds of input whose keys are not typing: Escape leaves Settings from them. */
const PRESSED_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

/**
 * Whether Escape, pressed somewhere on a Settings page, takes the person back
 * to the chats. Not when something on the page used it already (a search box
 * that cleared its words), and not from a place where Escape belongs to that
 * control or would drop what was typed: a text field, a list to pick from, a
 * question waiting for an answer, or a dialog.
 */
export function escapeLeavesSettings(event: {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  target: {
    /** The element's tag, such as "INPUT". */
    tag: string;
    /** An input's type. */
    type?: string;
    /** True for text the person can edit in place. */
    contentEditable?: boolean;
    /** True inside a dialog or a question (`role="alertdialog"`). */
    inDialog: boolean;
  };
}): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing)
    return false;
  const { tag, type, contentEditable, inDialog } = event.target;
  if (inDialog || contentEditable) return false;
  const name = tag.toUpperCase();
  if (name === "TEXTAREA" || name === "SELECT") return false;
  if (name === "INPUT")
    return PRESSED_INPUTS.has((type ?? "text").toLowerCase());
  return true;
}
