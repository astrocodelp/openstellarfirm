import "./gallery.css";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CATALOG,
  type CatalogEntry,
  type Category,
} from "../../shared/connection-catalog";
import {
  addedCounts,
  countByCategory,
  findServices,
  resultLine,
  rowEnd,
  usedCategories,
} from "../../shared/connection-gallery";
import { useSettledText } from "./a11y";
import { SearchInput } from "./SearchInput";
import { Choices } from "./SettingsParts";

interface GalleryProps {
  /** The saved connections, to show which services are already added. */
  connections: readonly { preset?: unknown }[];
  /** The catalog id whose add form is open, if any. */
  openId: string | null;
  onToggle(id: string | null): void;
  /** The add form for one service, drawn below its card's row. */
  renderForm(entry: CatalogEntry): ReactNode;
  onAddByAddress(): void;
  onAddComposio(): void;
  /** Opens the Mail screen, where a mailbox is added. */
  onMail?(): void;
}

/** Words that mean someone is looking for their own mailbox. */
const MAIL_WORDS =
  /\b(e-?mail|mail|inbox|gmail|outlook|imap|icloud|yahoo|proton|fastmail)/i;

/** How long the typing has to rest before the count is read out. */
const ANNOUNCE_AFTER_MS = 500;

/** The first thing to type into in an add form. */
const FIRST_FIELD = "input:not([type=hidden]):not(:disabled), select, textarea";

/** How many cards stand side by side in the grid right now. */
function useColumns(grid: { current: HTMLElement | null }, active: boolean) {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const el = grid.current;
    if (!el || !active) return;
    const measure = () => {
      const tracks = getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      setColumns(Math.max(1, tracks));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [grid, active]);
  return columns;
}

/**
 * Every service in the built-in list as a card: find one by typing, narrow it
 * to one group, and open its add form in place. Nothing here saves or
 * contacts anything; the form does that, and only on the person's click.
 */
export function ConnectionGallery({
  connections,
  openId,
  onToggle,
  renderForm,
  onAddByAddress,
  onAddComposio,
  onMail,
}: GalleryProps) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  /** The card whose form was open last, so the focus can go back to its button. */
  const lastOpen = useRef<string | null>(null);

  const groups = useMemo(() => usedCategories(), []);
  const counts = useMemo(() => countByCategory(query), [query]);
  const shown = useMemo(() => findServices(query, category), [query, category]);
  const added = useMemo(() => addedCounts(connections), [connections]);
  const line = resultLine(shown.length, CATALOG.length);
  // Read the count out once the typing rests, not on every key or on arrival.
  const announced = useSettledText(line, ANNOUNCE_AFTER_MS);
  const columns = useColumns(gridRef, shown.length > 0);

  const openIndex = shown.findIndex((entry) => entry.id === openId);
  const formAfter =
    openIndex === -1 ? -1 : rowEnd(openIndex, shown.length, columns);

  const cardId = (entry: { id: string }) => `${ids}-card-${entry.id}`;
  const formId = `${ids}-form`;

  // A form closed by its own Cancel or Save takes its fields away; the focus
  // goes back to the button that opened it rather than to the page.
  useEffect(() => {
    if (openId) {
      lastOpen.current = openId;
      return;
    }
    const was = lastOpen.current;
    lastOpen.current = null;
    if (!was) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      document
        .getElementById(`${ids}-card-${was}`)
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
    });
  }, [openId, ids]);

  /** Opens a card's form below its row and puts the caret in its first field. */
  function open(entry: CatalogEntry) {
    onToggle(entry.id);
    requestAnimationFrame(() => {
      const form = document.getElementById(formId);
      if (!form) return;
      form.scrollIntoView({ block: "nearest" });
      form.querySelector<HTMLElement>(FIRST_FIELD)?.focus({
        preventScroll: true,
      });
    });
  }

  function clear() {
    setQuery("");
    setCategory("all");
    searchRef.current?.focus();
  }

  const elsewhere = category !== "all" && shown.length === 0 && counts.all > 0;
  const openEntry = openIndex === -1 ? undefined : shown[openIndex];

  return (
    <div className="stack">
      <div className="gallery-tools">
        <label className="field gallery-search" htmlFor={`${ids}-search`}>
          <span className="field-label" id={`${ids}-label`}>
            Find a service
          </span>
          <SearchInput
            ref={searchRef}
            id={`${ids}-search`}
            aria-labelledby={`${ids}-label`}
            aria-describedby={`${ids}-hint`}
            aria-controls={`${ids}-list`}
            className="input"
            value={query}
            placeholder="GitHub, search, email…"
            onValueChange={setQuery}
            onEnter={() => {
              const first = shown[0];
              if (query.trim() && first) open(first);
            }}
          />
          <span className="faint" id={`${ids}-hint`}>
            By name, what it does or its group. Enter opens the first one, Esc
            clears.
          </span>
        </label>
        <Choices<Category | "all">
          legend="Show one group"
          legendHidden
          value={category}
          options={(["all", ...groups] as const).map((group) => ({
            id: group,
            name: (
              <>
                {group === "all" ? "All" : group}{" "}
                <span className="faint gallery-num">{counts[group]}</span>
              </>
            ),
          }))}
          onPick={setCategory}
        />
      </div>

      <p className="faint gallery-num" aria-hidden="true">
        {line}
      </p>
      <p className="visually-hidden" role="status">
        {announced}
      </p>

      {onMail && MAIL_WORDS.test(query) ? (
        <p className="card pad gallery-mail">
          Looking for your own mailbox? Gmail, Outlook, iCloud and any IMAP
          mailbox are added on the Mail screen, read only.{" "}
          <button type="button" className="link-btn" onClick={onMail}>
            Open Mail
          </button>
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="card pad stack-tight gallery-empty">
          <p>
            {elsewhere
              ? `No ${category} service matches “${query.trim()}”.`
              : query.trim()
                ? `No service matches “${query.trim()}”.`
                : "This group has no services yet."}
          </p>
          <p className="dim">
            If the service runs its own MCP server, add it by its address. Many
            more apps are reachable through your own Composio account.
          </p>
          <div className="wrap">
            {elsewhere ? (
              <button
                type="button"
                className="btn"
                onClick={() => setCategory("all")}
              >
                Show all groups
              </button>
            ) : (
              <button type="button" className="btn" onClick={clear}>
                Clear the search
              </button>
            )}
            <button type="button" className="btn" onClick={onAddByAddress}>
              Add by address
            </button>
            <button type="button" className="btn" onClick={onAddComposio}>
              Add Composio
            </button>
          </div>
        </div>
      ) : (
        <ul
          ref={gridRef}
          className="gallery-grid"
          id={`${ids}-list`}
          aria-label="Services you can add"
        >
          {shown.map((entry, index) => {
            const here = openId === entry.id;
            const n = added.get(entry.id) ?? 0;
            return (
              <Fragment key={entry.id}>
                <li
                  id={cardId(entry)}
                  className="service-card"
                  data-open={here}
                  data-added={n > 0}
                >
                  <div className="service-card-head">
                    <span className="row-name">{entry.name}</span>
                    {n > 0 ? (
                      <span className="badge badge-ok">
                        {n === 1 ? "Added" : `${n} added`}
                      </span>
                    ) : null}
                  </div>
                  <p className="dim gallery-desc">{entry.description}</p>
                  <div className="service-card-foot">
                    <span className="faint grow">
                      {entry.category}
                      {" · "}
                      {entry.reads ? "Mostly reads" : "Can change things"}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={here}
                      aria-controls={here ? formId : undefined}
                      aria-label={
                        here
                          ? `Close ${entry.name}`
                          : n > 0
                            ? `Add another ${entry.name} account`
                            : `Add ${entry.name}`
                      }
                      onClick={() => (here ? onToggle(null) : open(entry))}
                    >
                      {here ? "Close" : n > 0 ? "Add another account" : "Add"}
                    </button>
                  </div>
                </li>
                {index === formAfter && openEntry ? (
                  <li
                    id={formId}
                    className="service-form"
                    aria-label={`Add ${openEntry.name}`}
                  >
                    {renderForm(openEntry)}
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </ul>
      )}

      <p className="faint">
        Not in the list?{" "}
        <button type="button" className="link-btn" onClick={onAddByAddress}>
          Add it by address
        </button>{" "}
        or{" "}
        <button type="button" className="link-btn" onClick={onAddComposio}>
          use your own Composio account
        </button>
        .
      </p>
    </div>
  );
}
