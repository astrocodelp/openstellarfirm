import "./gallery.css";
import {
  type KeyboardEvent,
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
  usedCategories,
} from "../../shared/connection-gallery";

interface GalleryProps {
  /** The saved connections, to show which services are already added. */
  connections: readonly { preset?: unknown }[];
  /** The catalog id whose add form is open, if any. */
  openId: string | null;
  onToggle(id: string | null): void;
  /** The add form for one service, drawn inside its card. */
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
  const [announced, setAnnounced] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => usedCategories(), []);
  const counts = useMemo(() => countByCategory(query), [query]);
  const shown = useMemo(() => findServices(query, category), [query, category]);
  const added = useMemo(() => addedCounts(connections), [connections]);
  const line = resultLine(shown.length, CATALOG.length);

  // Read the count out once the typing rests, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(line), ANNOUNCE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [line]);

  function open(entry: CatalogEntry) {
    onToggle(entry.id);
    requestAnimationFrame(() =>
      document
        .getElementById(`${ids}-card-${entry.id}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
    } else if (event.key === "Enter") {
      event.preventDefault();
      const first = shown[0];
      if (query.trim() && first) open(first);
    }
  }

  function clear() {
    setQuery("");
    setCategory("all");
    searchRef.current?.focus();
  }

  const elsewhere = category !== "all" && shown.length === 0 && counts.all > 0;

  return (
    <div className="stack">
      <div className="gallery-tools">
        <label className="field gallery-search">
          <span className="field-label" id={`${ids}-label`}>
            Find a service
          </span>
          <input
            ref={searchRef}
            aria-labelledby={`${ids}-label`}
            aria-describedby={`${ids}-hint`}
            aria-controls={`${ids}-list`}
            className="input"
            type="search"
            value={query}
            placeholder="GitHub, search, email…"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
          <span className="faint" id={`${ids}-hint`}>
            By name, what it does or its group. Enter opens the first one, Esc
            clears.
          </span>
        </label>
        <fieldset className="plain gallery-filters">
          <legend className="visually-hidden">Show one group</legend>
          {(["all", ...groups] as const).map((group) => (
            <button
              key={group}
              type="button"
              className="choice gallery-filter"
              aria-pressed={category === group}
              onClick={() => setCategory(group)}
            >
              {group === "all" ? "All" : group}
              <span className="faint gallery-num">{counts[group]}</span>
            </button>
          ))}
        </fieldset>
      </div>

      <p className="faint gallery-num" aria-hidden="true">
        {line}
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">
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
          className="gallery-grid"
          id={`${ids}-list`}
          aria-label="Services you can add"
        >
          {shown.map((entry) => {
            const here = openId === entry.id;
            const n = added.get(entry.id) ?? 0;
            return (
              <li
                key={entry.id}
                id={`${ids}-card-${entry.id}`}
                className="gallery-card"
                data-open={here}
                data-added={n > 0}
              >
                <div className="gallery-card-head">
                  <span className="row-name">{entry.name}</span>
                  {n > 0 ? (
                    <span className="badge badge-ok">
                      {n === 1 ? "Added" : `${n} added`}
                    </span>
                  ) : null}
                </div>
                <p className="dim gallery-desc">{entry.description}</p>
                <div className="gallery-card-foot">
                  <span className="faint grow">
                    {entry.category}
                    {" · "}
                    {entry.reads ? "Mostly reads" : "Can change things"}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    aria-expanded={here}
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
                {here ? (
                  <div className="gallery-form">{renderForm(entry)}</div>
                ) : null}
              </li>
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
