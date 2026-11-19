import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { SEARCH_QUERY_MAX } from "../../shared/search";
import type { AppState, SearchHit } from "../../shared/types";
import { api } from "./bridge";
import {
  filterPalette,
  GROUP_LABELS,
  GROUP_ORDER,
  type PaletteGroup,
  type PaletteItem,
  type PaletteTarget,
  paletteItems,
  resultCount,
} from "./palette-items";
import { SearchInput } from "./SearchInput";
import { Icon, Pet } from "./ui";

/**
 * Find anything: one box, opened with Ctrl or Cmd+K or the sidebar's Find
 * button. A command menu is opened many times a day, so it appears at once,
 * with no motion; arrows move the choice and Enter opens it.
 */

/** How long typing must pause before the chats are searched. */
const SEARCH_PAUSE = 120;

/** The magnifier, drawn like the app's other icons. */
export function SearchGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

/** The shortcut as this computer writes it. */
export function findKeys(mac: boolean): { text: string; aria: string } {
  return mac
    ? { text: "⌘K", aria: "Meta+K" }
    : { text: "Ctrl K", aria: "Control+K" };
}

/**
 * Ctrl+K (Cmd+K on a Mac) opens and closes the palette from anywhere in the
 * app, unless another dialog is open.
 */
export function usePaletteShortcut(
  enabled: boolean,
  mac: boolean,
  toggle: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const mod = mac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey || event.repeat) return;
      if (event.key.toLowerCase() !== "k") return;
      if (document.querySelector("dialog[open]:not(.palette)")) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, mac, toggle]);
}

/** Jumps to one heading on the Settings screen and puts the focus on it. */
export function revealSection(title: string) {
  const heading = [
    ...document.querySelectorAll<HTMLElement>(
      ".settings-section > .section-title",
    ),
  ].find((h) => h.textContent?.trim() === title);
  if (!heading) return;
  heading.scrollIntoView({ block: "start", behavior: "instant" });
  focusQuietly(heading);
}

/** Puts the focus on the new screen's heading, so a screen reader starts there. */
export function focusScreen() {
  const heading = document.querySelector<HTMLElement>(
    ".main h1, .main .screen-title",
  );
  if (heading) focusQuietly(heading);
}

function focusQuietly(el: HTMLElement) {
  if (!el.hasAttribute("tabindex")) {
    el.setAttribute("tabindex", "-1");
    el.addEventListener("blur", () => el.removeAttribute("tabindex"), {
      once: true,
    });
  }
  el.focus({ preventScroll: true });
}

function when(at: string): string {
  const time = new Date(at);
  if (Number.isNaN(time.getTime())) return "";
  const clock = time.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const today = new Date();
  if (time.toDateString() === today.toDateString()) return `Today ${clock}`;
  const day = time.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    ...(time.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock}`;
}

interface Row {
  item: PaletteItem;
  hit?: SearchHit;
}

interface PaletteProps {
  state: AppState;
  /** The chat that is open, when it has something to save. */
  savableId: string | null;
  mac: boolean;
  onGo(target: PaletteTarget): void;
  onClose(): void;
}

export function Palette({
  state,
  savableId,
  mac,
  onGo,
  onClose,
}: PaletteProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [heard, setHeard] = useState("");
  const ids = useId();
  const listId = `${ids}-list`;
  const optionId = (index: number) => `${ids}-option-${index}`;
  const picked = useRef(false);
  /** True when the arrows or new words moved the choice, not the pointer. */
  const fromKeys = useRef(false);

  // The dialog is modal: the page behind it cannot be reached. When it closes
  // without a pick, the focus goes back to where it was.
  useEffect(() => {
    const box = dialog.current;
    const before = document.activeElement;
    if (box && !box.open) box.showModal();
    input.current?.focus();
    return () => {
      if (box?.open) box.close();
      if (
        !picked.current &&
        before instanceof HTMLElement &&
        before.isConnected
      )
        before.focus({ preventScroll: true });
    };
  }, []);

  // The chats are searched once typing pauses; the newest answer wins.
  useEffect(() => {
    const q = query.trim();
    setFailed(false);
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let live = true;
    const timer = setTimeout(() => {
      api
        .searchChats(q)
        .then((found) => {
          if (live) setHits(found);
        })
        .catch(() => {
          if (live) {
            setHits([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, SEARCH_PAUSE);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const savable = state.assistants.find((a) => a.id === savableId);
  const base = useMemo(
    () =>
      paletteItems({
        assistants: state.assistants,
        connections: state.connections,
        mailAccounts: state.mailAccounts,
        savable,
      }),
    [state.assistants, state.connections, state.mailAccounts, savable],
  );

  const rows = useMemo<Row[]>(() => {
    const listed: Row[] = filterPalette(base, query).map((item) => ({ item }));
    if (!query.trim()) return listed;
    for (const hit of hits) {
      const owner = state.assistants.find((a) => a.id === hit.assistantId);
      if (!owner) continue;
      listed.push({
        hit,
        item: {
          id: `message:${hit.messageId}`,
          group: "chats",
          label: owner.name,
          detail: `${hit.role === "user" ? "You" : owner.name} · ${when(hit.at)}`,
          target: {
            kind: "message",
            assistantId: hit.assistantId,
            messageId: hit.messageId,
          },
          pet: { pet: owner.pet, color: owner.color },
        },
      });
    }
    return listed;
  }, [base, query, hits, state.assistants]);

  // A new search starts at the top of the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the words change
  useEffect(() => {
    fromKeys.current = true;
    setActive(0);
  }, [query]);
  const current = Math.min(active, Math.max(rows.length - 1, 0));

  // The choice stays in view as the arrows move it. No smooth scroll: keys are
  // fast. Never for the pointer: the list must not move under the cursor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the choice moves
  useEffect(() => {
    if (!fromKeys.current) return;
    fromKeys.current = false;
    document
      .getElementById(optionId(current))
      ?.scrollIntoView({ block: "nearest" });
  }, [current, query]);

  // The count is said once the chats have answered, not on every key.
  useEffect(() => {
    if (!query.trim()) setHeard("");
    else if (!searching)
      setHeard(
        failed
          ? `${resultCount(rows.length)}. Your chats could not be searched just now.`
          : resultCount(rows.length),
      );
  }, [query, searching, rows.length, failed]);

  function pick(row: Row | undefined) {
    if (!row) return;
    // A pick that opens a dialog of its own gives the focus back afterwards;
    // one that moves to another place puts the focus there itself.
    const kind = row.item.target.kind;
    picked.current =
      kind !== "save-chat" && kind !== "import" && kind !== "shortcuts";
    onGo(row.item.target);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const count = rows.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      fromKeys.current = true;
      setActive((current + 1) % count);
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      fromKeys.current = true;
      setActive((current - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(rows[current]);
    }
  }

  // A click on the dimmed page around the box closes it.
  function onBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialog.current) onClose();
  }

  const typed = query.trim();
  const groups = GROUP_ORDER.map((group) => ({
    group,
    rows: rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.item.group === group),
  })).filter((g) => g.rows.length > 0);

  let line = "";
  if (!typed) line = "Find an assistant, a chat, a screen or a setting.";
  else if (rows.length === 0 && searching) line = "Looking in your chats…";
  else if (rows.length === 0)
    line = `Nothing matches “${typed}”. Try fewer words, or another spelling.`;

  const keys = findKeys(mac);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog; the click is only the backdrop
    <dialog
      ref={dialog}
      className="palette"
      aria-label="Find anything"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={onBackdrop}
    >
      {/* The box keeps the focus: a click on a heading or a line must not take it. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: only keeps the focus in the box */}
      <div
        className="palette-box"
        onMouseDown={(event) => {
          if (event.target !== input.current) event.preventDefault();
        }}
      >
        <div className="palette-field">
          <SearchGlyph size={18} />
          {/* Esc clears the words first, then closes; Enter opens the choice. */}
          <SearchInput
            ref={input}
            role="combobox"
            className="palette-input"
            aria-label="Find an assistant, a chat, a screen or a setting"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              rows.length > 0 ? optionId(current) : undefined
            }
            aria-describedby={`${ids}-line`}
            placeholder="Find anything"
            value={query}
            maxLength={SEARCH_QUERY_MAX}
            enterKeyHint="go"
            data-1p-ignore
            onValueChange={setQuery}
            onKeyDown={onKeyDown}
          />
          <span className="kbd" aria-hidden="true">
            Esc
          </span>
        </div>

        <p className="palette-line faint" id={`${ids}-line`}>
          {line}
        </p>

        <div
          id={listId}
          role="listbox"
          aria-label="Results"
          className="palette-list"
          aria-busy={searching || undefined}
        >
          {groups.map(({ group, rows: inGroup }) => (
            <Group key={group} group={group} id={`${ids}-${group}`}>
              {inGroup.map(({ row, index }) => (
                <Option
                  key={row.item.id}
                  id={optionId(index)}
                  row={row}
                  selected={index === current}
                  onPoint={() => {
                    if (index !== current) setActive(index);
                  }}
                  onPick={() => pick(row)}
                />
              ))}
            </Group>
          ))}
        </div>
        {failed ? (
          <p className="palette-line faint">
            Your chats could not be searched just now. The rest of the list
            still works.
          </p>
        ) : null}

        <p className="palette-foot faint" aria-hidden="true">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to move
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to open
          </span>
          <span>
            <kbd className="kbd">{keys.text}</kbd> or{" "}
            <kbd className="kbd">Esc</kbd> to close
          </span>
        </p>
        <p className="visually-hidden" role="status">
          {heard}
        </p>
      </div>
    </dialog>
  );
}

function Group({
  group,
  id,
  children,
}: {
  group: PaletteGroup;
  id: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group inside a listbox cannot be a fieldset
    <div role="group" aria-labelledby={id} className="palette-group">
      <div id={id} role="presentation" className="palette-group-label">
        {GROUP_LABELS[group]}
      </div>
      {children}
    </div>
  );
}

function Option({
  id,
  row,
  selected,
  onPoint,
  onPick,
}: {
  id: string;
  row: Row;
  selected: boolean;
  onPoint(): void;
  onPick(): void;
}) {
  const { item, hit } = row;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the box's arrows and Enter choose an option
    // biome-ignore lint/a11y/useFocusableInteractive: the box keeps the focus; aria-activedescendant points here
    <div
      id={id}
      role="option"
      aria-selected={selected}
      className="palette-option"
      onPointerMove={onPoint}
      onClick={onPick}
    >
      <span className="palette-mark">
        {item.pet ? (
          <Pet pet={item.pet.pet} color={item.pet.color} size={24} />
        ) : (
          <Icon name={glyphFor(item.target)} size={16} />
        )}
      </span>
      <span className="palette-text">
        <span className="palette-label">
          <span className="row-name">{item.label}</span>
          {item.detail ? (
            <span className="palette-detail">{item.detail}</span>
          ) : null}
        </span>
        {hit ? (
          <span className="palette-snippet">
            {hit.parts.map((part, index) =>
              part.match ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of parts
                <mark key={index}>{part.text}</mark>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of parts
                <span key={index}>{part.text}</span>
              ),
            )}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function glyphFor(
  target: PaletteTarget,
): "plus" | "upload" | "download" | "gear" | "sliders" | "link" | "mail" {
  switch (target.kind) {
    case "new":
      return "plus";
    case "import":
      return "upload";
    case "shortcuts":
      return "sliders";
    case "save-chat":
      return "download";
    case "section":
      return "gear";
    case "screen":
      return target.screen === "models"
        ? "sliders"
        : target.screen === "connections"
          ? "link"
          : target.screen === "mail"
            ? "mail"
            : target.screen === "backup"
              ? "download"
              : "gear";
    default:
      return "link";
  }
}
