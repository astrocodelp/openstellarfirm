import type { ModelInfo } from "../../shared/types";

/**
 * The rules of the model picker, kept apart from the page so they can be
 * tested: the order models are shown in, what a typed filter keeps, the one
 * line said about each model, and what each key does.
 */

/** The most rows drawn at once; typing narrows the rest. */
export const MAX_SHOWN = 200;

/**
 * The order a list is shown in: the recommended model first, then the newest
 * where the list says when each was made, then the rest by name.
 */
export function orderModels(
  models: ModelInfo[],
  recommended?: string,
): ModelInfo[] {
  return [...models].sort((a, b) => {
    if (recommended) {
      if (a.id === recommended && b.id !== recommended) return -1;
      if (b.id === recommended && a.id !== recommended) return 1;
    }
    const at = a.created ?? 0;
    const bt = b.created ?? 0;
    if (at !== bt) return bt - at;
    return a.id.localeCompare(b.id);
  });
}

/**
 * The models a typed filter keeps: every word must be in the id or the name,
 * in any case. An exact id comes first, then ids that start with the words,
 * and the order is otherwise kept.
 */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const typed = query.trim().toLowerCase();
  if (!typed) return models;
  const words = typed.split(/\s+/);
  const kept = models.filter((m) => {
    const hay = `${m.id} ${m.name ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const rank = (m: ModelInfo) => {
    const id = m.id.toLowerCase();
    if (id === typed) return 0;
    if (id.startsWith(typed)) return 1;
    return 2;
  };
  return kept
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i)
    .map(({ m }) => m);
}

/** A token count the way people say it: 8K, 128K, 1M, 1.5M. */
export function contextText(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/** What the list says about a model, as one short line, or "". */
export function modelFacts(model: ModelInfo): string {
  const parts: string[] = [];
  if (model.context) parts.push(`${contextText(model.context)} context`);
  if (model.pictures) parts.push("reads pictures");
  if (model.tools) parts.push("uses tools");
  return parts.join(" · ");
}

export interface PickerState {
  open: boolean;
  /** The highlighted row, or -1 when none is. */
  active: number;
}

export interface PickerKey {
  key: string;
  altKey?: boolean;
  isComposing?: boolean;
}

export interface PickerKeyResult {
  state: PickerState;
  /** The row Enter chose, if it chose one. */
  choose?: number;
  /** True when the key is used here: the page must not act on it too. */
  prevent: boolean;
  /** True when the key must not reach what holds the box, such as a dialog. */
  stop: boolean;
}

/**
 * What a key does in the model box, given how many rows are showing. Enter
 * never submits the form around it: it chooses the highlighted row, or keeps
 * what was typed and closes the list. Esc closes an open list and goes no
 * further; with the list closed it is left to whatever holds the box.
 */
export function pickerKey(
  state: PickerState,
  event: PickerKey,
  count: number,
): PickerKeyResult {
  const same = { state, prevent: false, stop: false };
  if (event.isComposing) return same;
  switch (event.key) {
    case "ArrowDown": {
      if (count === 0) return { ...same, prevent: true };
      if (!state.open) {
        // Opening keeps the row already chosen; Alt+Down opens without moving.
        const kept = state.active >= 0 && state.active < count;
        const active = kept ? state.active : event.altKey ? -1 : 0;
        return { state: { open: true, active }, prevent: true, stop: false };
      }
      return {
        state: { open: true, active: (state.active + 1) % count },
        prevent: true,
        stop: false,
      };
    }
    case "ArrowUp": {
      if (count === 0) return { ...same, prevent: true };
      if (event.altKey) {
        return { state: { ...state, open: false }, prevent: true, stop: false };
      }
      if (!state.open) {
        return {
          state: { open: true, active: count - 1 },
          prevent: true,
          stop: false,
        };
      }
      const from = Math.max(state.active, 0);
      return {
        state: { open: true, active: (from - 1 + count) % count },
        prevent: true,
        stop: false,
      };
    }
    case "Enter": {
      const chose = state.open && state.active >= 0 && state.active < count;
      return {
        state: { open: false, active: state.active },
        ...(chose ? { choose: state.active } : {}),
        prevent: true,
        stop: false,
      };
    }
    case "Escape":
      if (!state.open) return same;
      return { state: { ...state, open: false }, prevent: true, stop: true };
    case "Tab":
      return { ...same, state: { ...state, open: false } };
    default:
      return same;
  }
}
