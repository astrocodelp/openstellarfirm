import { normalise, searchTerms } from "../../shared/search";
import type {
  Assistant,
  Connection,
  MailAccount,
  PetColor,
  PetId,
} from "../../shared/types";
import { SETTINGS_SECTIONS } from "./settings-sections";

/**
 * What the palette (Ctrl or Cmd+K) can find, and how it filters it. Pure, so
 * the rules can be tested without a page. Chats are searched in the main
 * process; everything else is a short list kept here.
 */

export type PaletteScreen =
  | "models"
  | "connections"
  | "mail"
  | "backup"
  | "settings";

/** Where a result takes the person. */
export type PaletteTarget =
  | { kind: "assistant"; id: string }
  | { kind: "message"; assistantId: string; messageId: string }
  | { kind: "screen"; screen: PaletteScreen }
  | { kind: "section"; title: string }
  | { kind: "new" }
  | { kind: "import" }
  | { kind: "shortcuts" }
  | { kind: "save-chat"; assistantId: string };

export type PaletteGroup =
  | "assistants"
  | "actions"
  | "screens"
  | "settings"
  | "connections"
  | "chats";

/** The order the groups are shown in. Chats go last: there can be many. */
export const GROUP_ORDER: readonly PaletteGroup[] = [
  "assistants",
  "actions",
  "screens",
  "settings",
  "connections",
  "chats",
];

export const GROUP_LABELS: Record<PaletteGroup, string> = {
  assistants: "Assistants",
  actions: "Actions",
  screens: "Screens",
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
}

const SCREENS: { screen: PaletteScreen; label: string; keywords: string }[] = [
  {
    screen: "models",
    label: "Models",
    keywords: "model source key ollama lm studio openai claude local",
  },
  {
    screen: "connections",
    label: "Connections",
    keywords: "mcp server tools services github composio link",
  },
  { screen: "mail", label: "Mail", keywords: "inbox email mailbox imap" },
];

export { SETTINGS_SECTIONS } from "./settings-sections";

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
      id: "action:backup",
      group: "actions",
      label: "Move or back up",
      keywords: "backup export import another computer file",
      target: { kind: "screen", screen: "backup" },
    },
    {
      id: "action:settings",
      group: "actions",
      label: "Settings",
      keywords: "preferences options",
      target: { kind: "screen", screen: "settings" },
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
  for (const s of SCREENS) {
    items.push({
      id: `screen:${s.screen}`,
      group: "screens",
      label: s.label,
      keywords: s.keywords,
      target: { kind: "screen", screen: s.screen },
    });
  }
  for (const s of SETTINGS_SECTIONS) {
    items.push({
      id: `section:${s.title}`,
      group: "settings",
      label: s.title,
      detail: "Settings",
      keywords: s.keywords,
      target: { kind: "section", title: s.title },
    });
  }
  for (const c of sources.connections) {
    items.push({
      id: `connection:${c.id}`,
      group: "connections",
      label: c.name,
      detail: "Connection",
      target: { kind: "screen", screen: "connections" },
    });
  }
  for (const m of sources.mailAccounts) {
    items.push({
      id: `mail:${m.id}`,
      group: "connections",
      label: m.name,
      detail: "Mail",
      target: { kind: "screen", screen: "mail" },
    });
  }
  return items;
}

/** The groups shown before anything is typed. */
const RESTING: readonly PaletteGroup[] = ["assistants", "actions", "screens"];

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
 * most `GROUP_LIMIT` a group. With nothing typed: assistants, actions, screens.
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
      if (RESTING.includes(group))
        picked.push(...inGroup.slice(0, GROUP_LIMIT));
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
