import { normalise, searchTerms } from "../../shared/search";
import type {
  Assistant,
  Connection,
  MailAccount,
  PetColor,
  PetId,
} from "../../shared/types";
import {
  pageOfSection,
  pageTitle,
  SETTINGS_PAGES,
  SETTINGS_SECTIONS,
  type SettingsPageId,
  type SettingsSectionId,
  sectionStandsAlone,
} from "./settings-sections";

/**
 * What the palette (Ctrl or Cmd+K) can find, and how it filters it. Pure, so
 * the rules can be tested without a page. Chats are searched in the main
 * process; everything else is a short list kept here.
 */

/**
 * Where a result takes the person. Every screen that sets the app up is a
 * page of Settings: with no page, Settings opens where it was left; a section
 * opens its own page at that section.
 */
export type PaletteTarget =
  | { kind: "assistant"; id: string }
  | { kind: "message"; assistantId: string; messageId: string }
  | { kind: "settings"; page?: SettingsPageId; section?: SettingsSectionId }
  | { kind: "new" }
  | { kind: "import" }
  | { kind: "shortcuts" }
  | { kind: "save-chat"; assistantId: string };

export type PaletteGroup =
  | "assistants"
  | "actions"
  | "settings"
  | "connections"
  | "chats";

/** The order the groups are shown in. Chats go last: there can be many. */
export const GROUP_ORDER: readonly PaletteGroup[] = [
  "assistants",
  "actions",
  "settings",
  "connections",
  "chats",
];

export const GROUP_LABELS: Record<PaletteGroup, string> = {
  assistants: "Assistants",
  actions: "Actions",
  settings: "Settings",
  connections: "Connections",
  chats: "In chats",
};

/** The most shown from one group, so one group never pushes the rest away. */
export const GROUP_LIMIT = 8;

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** A second, quieter line, such as an assistant's group. */
  detail?: string;
  /** More words it answers to, never shown. */
  keywords?: string;
  target: PaletteTarget;
  pet?: { pet: PetId; color: PetColor };
  /** Listed before anything is typed, though its group is not. */
  resting?: boolean;
}

export { SETTINGS_PAGES, SETTINGS_SECTIONS } from "./settings-sections";

export interface PaletteSources {
  assistants: readonly Assistant[];
  connections: readonly Connection[];
  mailAccounts: readonly MailAccount[];
  /** The chat that is open, when it has something to save. */
  savable?: Assistant | undefined;
}

/** Everything the palette lists, apart from what is found in chats. */
export function paletteItems(sources: PaletteSources): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const a of sources.assistants) {
    items.push({
      id: `assistant:${a.id}`,
      group: "assistants",
      label: a.name,
      detail: a.group,
      target: { kind: "assistant", id: a.id },
      pet: { pet: a.pet, color: a.color },
    });
  }
  items.push(
    {
      id: "action:new",
      group: "actions",
      label: "New assistant",
      keywords: "make create add",
      target: { kind: "new" },
    },
    {
      id: "action:settings",
      group: "actions",
      label: "Settings",
      keywords: "preferences options",
      target: { kind: "settings" },
    },
    {
      id: "action:import",
      group: "actions",
      label: "Import an assistant file",
      keywords: "open add file",
      target: { kind: "import" },
    },
    {
      id: "action:shortcuts",
      group: "actions",
      label: "Keyboard shortcuts",
      keywords: "keys keyboard shortcut help list",
      target: { kind: "shortcuts" },
    },
  );
  if (sources.savable) {
    items.push({
      id: "action:save-chat",
      group: "actions",
      label: "Save this chat",
      detail: `The chat with ${sources.savable.name}, as a Markdown file`,
      keywords: "export markdown download file",
      target: { kind: "save-chat", assistantId: sources.savable.id },
    });
  }
  // The pages that are screens of their own (Models, Mail) are listed before
  // anything is typed, as they were when they had a place in the sidebar.
  for (const p of SETTINGS_PAGES) {
    // A page that is one section answers to that section's words too.
    const own = SETTINGS_SECTIONS.filter(
      (s) =>
        (p.sections as readonly string[]).includes(s.id) &&
        sectionStandsAlone(s.id),
    );
    items.push({
      id: `page:${p.id}`,
      group: "settings",
      label: p.title,
      detail: "Settings",
      keywords: [p.keywords, ...own.map((s) => s.keywords)].join(" "),
      target: { kind: "settings", page: p.id },
      ...(p.sections.length === 0 ? { resting: true } : {}),
    });
  }
  // A section that is its whole page is found as the page.
  for (const s of SETTINGS_SECTIONS) {
    if (sectionStandsAlone(s.id)) continue;
    items.push({
      id: `section:${s.id}`,
      group: "settings",
      label: s.title,
      detail: `Settings, ${pageTitle(pageOfSection(s.id))}`,
      keywords: s.keywords,
      target: { kind: "settings", section: s.id },
    });
  }
  for (const c of sources.connections) {
    items.push({
      id: `connection:${c.id}`,
      group: "connections",
      label: c.name,
      detail: "Connection",
      target: { kind: "settings", page: "connections" },
    });
  }
  for (const m of sources.mailAccounts) {
    items.push({
      id: `mail:${m.id}`,
      group: "connections",
      label: m.name,
      detail: "Mail",
      target: { kind: "settings", page: "mail" },
    });
  }
  return items;
}

/** The groups shown before anything is typed, with the items marked `resting`. */
const RESTING: readonly PaletteGroup[] = ["assistants", "actions"];

/**
 * How well an item matches, lower first; null when a word is missing.
 * 0: the name is the search. 1: the name starts with it. 2: every word starts
 * a word of the name. 3: every word is in the name. 4: found only in the
 * quieter line or the words it answers to.
 */
export function paletteScore(
  item: PaletteItem,
  terms: string[],
): number | null {
  if (terms.length === 0) return null;
  const label = normalise(item.label);
  const extra = normalise(`${item.detail ?? ""} ${item.keywords ?? ""}`);
  if (!terms.every((t) => label.includes(t) || extra.includes(t))) return null;
  const phrase = terms.join(" ");
  if (label === phrase) return 0;
  if (label.startsWith(phrase)) return 1;
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (terms.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  if (terms.every((t) => label.includes(t))) return 3;
  return 4;
}

/**
 * The items for what is typed, in group order, best first within a group, at
 * most `GROUP_LIMIT` a group. With nothing typed: assistants, actions, and the
 * Settings pages that are screens of their own.
 */
export function filterPalette(
  items: readonly PaletteItem[],
  query: string,
): PaletteItem[] {
  const terms = searchTerms(query);
  const picked: PaletteItem[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = items.filter((item) => item.group === group);
    if (terms.length === 0) {
      const resting = RESTING.includes(group)
        ? inGroup
        : inGroup.filter((item) => item.resting);
      picked.push(...resting.slice(0, GROUP_LIMIT));
      continue;
    }
    const scored = inGroup
      .map((item, index) => ({ item, index, score: paletteScore(item, terms) }))
      .filter(
        (entry): entry is { item: PaletteItem; index: number; score: number } =>
          entry.score !== null,
      )
      .sort((a, b) => a.score - b.score || a.index - b.index);
    picked.push(...scored.slice(0, GROUP_LIMIT).map((entry) => entry.item));
  }
  return picked;
}

/** The palette's list split in two: what can be chosen, and what cannot yet. */
export interface PaletteRows<T> {
  /** Reached by the arrows, Enter and a click, in this order. */
  choosable: T[];
  /**
   * Chat results found for earlier words, kept on screen, dimmed, while the
   * search for the words typed now runs, so the list does not flicker. They
   * cannot be chosen: they may no longer match.
   */
  stale: T[];
}

/**
 * Puts the chat results with the rest of the list only when they were found
 * for the words typed now. `answeredFor` is the search the chat results
 * answer; the other groups are filtered as the words are typed, so they are
 * always current.
 */
export function arrangePaletteRows<T>(
  listed: readonly T[],
  chats: readonly T[],
  query: string,
  answeredFor: string,
): PaletteRows<T> {
  const typed = query.trim();
  if (!typed) return { choosable: [...listed], stale: [] };
  if (answeredFor.trim() === typed)
    return { choosable: [...listed, ...chats], stale: [] };
  return { choosable: [...listed], stale: [...chats] };
}

/** The words a screen reader hears after the list changes. */
export function resultCount(count: number): string {
  if (count === 0) return "No results";
  return count === 1 ? "1 result" : `${count} results`;
}
