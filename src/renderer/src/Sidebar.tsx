import { type ReactNode, useLayoutEffect, useRef } from "react";
import { plainLine } from "../../shared/markdown";
import type { Assistant } from "../../shared/types";
import { SearchGlyph } from "./Palette";
import { Icon, Nova, OkLine, Pet } from "./ui";

interface SidebarProps {
  assistants: Assistant[];
  selected: string | null;
  /** The assistants that are answering right now. */
  busy: Set<string>;
  /** The assistants with a step that waits for the person. */
  waiting: Set<string>;
  /** The assistants with an update from a check that has not been seen. */
  unread: Set<string>;
  showCloudCard: boolean;
  /** The screen that is open, so its link in the foot reads as the current one. */
  current?:
    | "models"
    | "connections"
    | "mail"
    | "backup"
    | "settings"
    | undefined;
  onSelect(id: string): void;
  onNew(): void;
  onImport(): void;
  onBackup(): void;
  onModels(): void;
  onSettings(): void;
  onConnections(): void;
  onMail(): void;
  onCloud(): void;
  onHideCloudCard(): void;
  /** A quiet notice above the foot, such as "a new version is available". */
  notice?: ReactNode;
  /** Opens Find anything, for people who do not use the shortcut. */
  onFind?: () => void;
  /** The shortcut as this computer writes it, such as "Ctrl K". */
  findKeys?: { text: string; aria: string };
}

/**
 * One highlight behind the open assistant's row. It moves to the row that is
 * opened, so the eye follows the change instead of seeing two rows blink.
 * Placed by measuring the row; only its transform and opacity change.
 */
function useRowHighlight(selected: string | null, rows: unknown) {
  const scroll = useRef<HTMLElement>(null);
  const mark = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: place it again when the rows change
  useLayoutEffect(() => {
    const box = scroll.current;
    const el = mark.current;
    if (!box || !el) return;
    const place = () => {
      const row = selected
        ? box.querySelector<HTMLElement>(`[data-row="${CSS.escape(selected)}"]`)
        : null;
      if (!row) {
        el.dataset.shown = "false";
        return;
      }
      el.style.height = `${row.offsetHeight}px`;
      el.style.transform = `translateY(${row.offsetTop}px)`;
      // The first placement, and one after the row was hidden, does not glide.
      if (el.dataset.shown !== "true") {
        el.dataset.glide = "false";
        el.getBoundingClientRect();
      }
      el.dataset.shown = "true";
      requestAnimationFrame(() => {
        el.dataset.glide = "true";
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(box);
    return () => observer.disconnect();
  }, [selected, rows]);
  return { scroll, mark };
}

export function Sidebar(props: SidebarProps) {
  const { assistants, selected, busy, waiting, unread } = props;
  const highlight = useRowHighlight(selected, assistants);
  // Groups keep the order in which their first assistant was made.
  const groups = [...new Set(assistants.map((a) => a.group))];
  const line = (a: Assistant) => {
    if (waiting.has(a.id)) return "Waiting for your Approve";
    if (busy.has(a.id)) return "Working…";
    if (unread.has(a.id)) return "New update from a check";
    // A line saved by an older version may still carry Markdown marks.
    return a.lastLine ? plainLine(a.lastLine) : "No messages yet";
  };
  const nav = (
    name: "models" | "connections" | "mail" | "backup" | "settings",
    label: string,
    icon: "sliders" | "link" | "mail" | "download" | "gear",
    onClick: () => void,
  ) => (
    <li key={name}>
      <button
        type="button"
        className="nav-item"
        aria-current={props.current === name ? "page" : undefined}
        onClick={onClick}
      >
        <Icon name={icon} size={18} />
        {label}
      </button>
    </li>
  );
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="sidebar-head">
        <Nova size={48} />
        <div className="brand-text">
          <div className="brand-name">OpenStellarFirm</div>
          <OkLine>Runs on this computer</OkLine>
        </div>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="btn" onClick={props.onNew}>
          <Icon name="plus" size={18} />
          New assistant
        </button>
        {props.onFind ? (
          <button
            type="button"
            className="nav-item find-btn"
            aria-keyshortcuts={props.findKeys?.aria}
            onClick={props.onFind}
          >
            <SearchGlyph size={18} />
            Find anything
            {props.findKeys ? (
              <span className="kbd" aria-hidden="true">
                {props.findKeys.text}
              </span>
            ) : null}
          </button>
        ) : null}
        <button type="button" className="nav-item" onClick={props.onImport}>
          <Icon name="upload" size={18} />
          Import an assistant file
        </button>
      </div>

      <nav
        ref={highlight.scroll}
        className="sidebar-scroll"
        aria-label="Your assistants"
      >
        <div
          ref={highlight.mark}
          className="row-highlight"
          aria-hidden="true"
        />
        {groups.map((group) => (
          <section key={group} aria-label={group}>
            <div className="group-label">{group}</div>
            {assistants
              .filter((a) => a.group === group)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="row"
                  data-row={a.id}
                  aria-current={a.id === selected ? "true" : undefined}
                  onClick={() => props.onSelect(a.id)}
                >
                  <Pet
                    pet={a.pet}
                    color={a.color}
                    busy={busy.has(a.id) && !waiting.has(a.id)}
                  />
                  <span className="row-text">
                    <span className="row-name">{a.name}</span>
                    <span className="row-line">{line(a)}</span>
                  </span>
                  {waiting.has(a.id) ? (
                    <span className="dot" role="img" aria-label="Needs you" />
                  ) : unread.has(a.id) ? (
                    <span
                      className="dot dot-update"
                      role="img"
                      aria-label="New update"
                    />
                  ) : null}
                </button>
              ))}
          </section>
        ))}

        <div className="sidebar-end">
          {props.showCloudCard ? (
            // Named by its own heading: Settings has a section called
            // "StellarFirm cloud", and two landmarks must not share a name.
            <section className="cloud-card" aria-label="Need it in the cloud?">
              <div className="cloud-head">
                <span className="row-name">Need it in the cloud?</span>
                <button
                  type="button"
                  className="close-btn"
                  aria-label="Hide this"
                  title="Hide this"
                  onClick={props.onHideCloudCard}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
              <p className="faint">
                A team of assistants with cloud computers of their own, which
                keep working when this computer is off.
              </p>
              <button
                type="button"
                className="btn btn-small cloud-btn"
                onClick={props.onCloud}
              >
                See StellarFirm
                <Icon name="external" size={14} />
              </button>
            </section>
          ) : null}
          {props.notice}
        </div>
      </nav>

      <nav aria-label="The app">
        <ul className="sidebar-nav">
          {nav("models", "Models", "sliders", props.onModels)}
          {nav("connections", "Connections", "link", props.onConnections)}
          {nav("mail", "Mail", "mail", props.onMail)}
          {nav("backup", "Move or back up", "download", props.onBackup)}
          {nav("settings", "Settings", "gear", props.onSettings)}
        </ul>
      </nav>
    </aside>
  );
}
