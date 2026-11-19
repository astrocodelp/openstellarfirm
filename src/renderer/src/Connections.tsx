import { type FormEvent, useId, useState } from "react";
import {
  type CatalogEntry,
  catalogEntry,
  catalogIdOf,
  serviceLabel,
} from "../../shared/connection-catalog";
import { noKeychainNote } from "../../shared/keychain";
import type {
  AppState,
  CompanyOffer,
  Connection,
  ConnectionTool,
} from "../../shared/types";
import { api } from "./bridge";
import { ConnectionGallery } from "./ConnectionGallery";
import { pageTitle } from "./settings-sections";
import {
  ErrorLine,
  message as errorText,
  InlineConfirm,
  OkLine,
  ScreenHead,
} from "./ui";

/** Each tool, with whether it only reads or asks every time. */
function ToolList({ tools }: { tools: ConnectionTool[] }) {
  if (tools.length === 0)
    return <p className="faint">This connection offers no tools.</p>;
  return (
    <ul className="list card" aria-label="Tools it offers">
      {tools.map((tool) => (
        <li key={tool.name}>
          <span className="grow stack-tight">
            <span className="mono">{tool.name}</span>
            {tool.description ? (
              <span className="faint">{tool.description}</span>
            ) : null}
          </span>
          <span className="badge">
            {tool.readOnly ? "Reads" : "Asks every time"}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface FormProps {
  keychain: boolean;
  editing?: Connection;
  /** A name and address to start with, from a company look-up. */
  prefill?: { name: string; baseUrl: string };
  /** False while another form on the screen holds the one lime button. */
  primary?: boolean;
  onSaved(): void;
  onCancel?: () => void;
}

/** Adds a connection, or changes one. The tools always come from the server. */
function ConnectionForm({
  keychain,
  editing,
  prefill,
  primary = true,
  onSaved,
  onCancel,
}: FormProps) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? prefill?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(
    editing?.baseUrl ?? prefill?.baseUrl ?? "",
  );
  const [apiKey, setApiKey] = useState("");
  const [tools, setTools] = useState<ConnectionTool[] | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "save">("");
  const [error, setError] = useState("");

  const input = () => ({
    ...(editing ? { id: editing.id } : {}),
    name,
    baseUrl,
    apiKey,
  });

  async function check() {
    setBusy("check");
    setError("");
    try {
      setTools(await api.checkConnection(input()));
    } catch (e) {
      setTools(null);
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      await api.saveConnection(input());
      setApiKey("");
      setTools(null);
      if (!editing) {
        setName("");
        setBaseUrl("");
      }
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          placeholder="Team notes"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-address`}>
          Address
        </span>
        <input
          aria-labelledby={`${ids}-address`}
          aria-describedby={`${ids}-address-note`}
          className="input mono"
          value={baseUrl}
          placeholder="https://tools.example.com/mcp"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <span className="faint" id={`${ids}-address-note`}>
          Starts with https://, or http:// on this computer, with no sign-in or
          “?” in it.
        </span>
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-key`}>
          Key, if it needs one
        </span>
        <input
          aria-labelledby={`${ids}-key`}
          aria-describedby={`${ids}-key-note`}
          className="input mono"
          type="password"
          value={apiKey}
          placeholder={editing?.hasKey ? "Saved. Leave empty to keep it." : ""}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="faint" id={`${ids}-key-note`}>
          {keychain
            ? "Kept in this computer's keychain, sent only to this address and never shown again."
            : noKeychainNote(document.documentElement.dataset.platform, "key")}
        </span>
      </label>

      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy !== "" || !baseUrl.trim()}
          onClick={() => void check()}
        >
          {busy === "check" ? "Checking…" : "Check"}
        </button>
      </div>
      {tools ? (
        <div className="stack-tight">
          <OkLine>
            It answered.{" "}
            {tools.length === 1 ? "1 tool" : `${tools.length} tools`}
          </OkLine>
          <ToolList tools={tools} />
        </div>
      ) : null}

      <ErrorLine>{error}</ErrorLine>
      <div className="wrap">
        <button
          type="submit"
          className={primary ? "btn btn-primary" : "btn"}
          disabled={busy !== "" || !name.trim() || !baseUrl.trim()}
        >
          {busy === "save" ? "Saving…" : editing ? "Save" : "Add"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

interface CatalogFormProps {
  entry: CatalogEntry;
  keychain: boolean;
  editing?: Connection;
  /** The name to start with when adding. */
  suggestedName?: string;
  onSaved(): void;
  onCancel(): void;
}

const KEY_PROMISE = (service: string) =>
  `Kept in this computer's keychain, sent only to ${service} and never shown again.`;

/** Adds or changes one service from the built-in list: a name and the person's own key. */
function CatalogForm({
  entry,
  keychain,
  editing,
  suggestedName,
  onSaved,
  onCancel,
}: CatalogFormProps) {
  const ids = useId();
  const [name, setName] = useState(
    editing?.name ?? suggestedName ?? entry.name,
  );
  const [apiKey, setApiKey] = useState("");
  const [tools, setTools] = useState<ConnectionTool[] | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "save">("");
  const [error, setError] = useState("");
  const needsKey = !editing?.hasKey;
  const input = () => ({
    catalogId: entry.id,
    ...(editing ? { id: editing.id } : {}),
    name,
    apiKey,
  });

  async function check() {
    setBusy("check");
    setError("");
    try {
      setTools(await api.checkCatalog(input()));
    } catch (e) {
      setTools(null);
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      await api.saveCatalog(input());
      setApiKey("");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <p className="dim">{entry.where}</p>
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => void api.openLink(`catalog:${entry.id}`)}
        >
          {entry.name}'s page about this
        </button>
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <span className="faint">
          A name of its own, such as Work or Personal.
        </span>
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-key`}>
          Your {entry.name} key
        </span>
        <input
          aria-labelledby={`${ids}-key`}
          aria-describedby={`${ids}-key-note`}
          className="input mono"
          type="password"
          value={apiKey}
          placeholder={editing?.hasKey ? "Saved. Leave empty to keep it." : ""}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="faint" id={`${ids}-key-note`}>
          {keychain
            ? KEY_PROMISE(entry.name)
            : noKeychainNote(document.documentElement.dataset.platform, "key")}
        </span>
      </label>
      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy !== "" || (needsKey && !apiKey.trim())}
          onClick={() => void check()}
        >
          {busy === "check" ? "Checking…" : "Check"}
        </button>
      </div>
      {tools ? (
        <div className="stack-tight">
          <OkLine>
            It answered.{" "}
            {tools.length === 1 ? "1 tool" : `${tools.length} tools`}
          </OkLine>
          <ToolList tools={tools} />
        </div>
      ) : null}
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy !== "" || !name.trim() || (needsKey && !apiKey.trim())}
        >
          {busy === "save" ? "Saving…" : editing ? "Save" : `Add ${entry.name}`}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

interface ComposioFormProps {
  keychain: boolean;
  editing?: Connection;
  primary?: boolean;
  onSaved(): void;
  onCancel?: () => void;
}

/** Adds or changes a Composio connection: a name and the person's own key. */
function ComposioForm({
  keychain,
  editing,
  primary = true,
  onSaved,
  onCancel,
}: ComposioFormProps) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "Composio");
  const [apiKey, setApiKey] = useState("");
  const [tools, setTools] = useState<ConnectionTool[] | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "save">("");
  const [error, setError] = useState("");
  const needsKey = !editing?.hasKey;
  const input = () => ({
    ...(editing ? { id: editing.id } : {}),
    name,
    apiKey,
  });

  async function check() {
    setBusy("check");
    setError("");
    try {
      setTools(await api.checkComposio(input()));
    } catch (e) {
      setTools(null);
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      await api.saveComposio(input());
      setApiKey("");
      setTools(null);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <p className="dim">
        It uses your own Composio account, so any cost is between you and
        Composio.
      </p>
      <details className="how">
        <summary>How Composio works</summary>
        <p className="faint">
          This uses your own Composio account and key. Your usage and any cost
          are between you and Composio. What you send through it leaves this
          computer. Every tool call still asks you first.
        </p>
      </details>
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => void api.openLink("composio")}
        >
          Get a key at composio.dev
        </button>
      </div>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={name}
          maxLength={40}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-key`}>
          Your Composio key
        </span>
        <input
          aria-labelledby={`${ids}-key`}
          aria-describedby={`${ids}-key-note`}
          className="input mono"
          type="password"
          value={apiKey}
          placeholder={editing?.hasKey ? "Saved. Leave empty to keep it." : ""}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="faint" id={`${ids}-key-note`}>
          {keychain
            ? "Kept in this computer's keychain, sent only to Composio and never shown again."
            : noKeychainNote(document.documentElement.dataset.platform, "key")}
        </span>
      </label>
      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy !== "" || (needsKey && !apiKey.trim())}
          onClick={() => void check()}
        >
          {busy === "check" ? "Checking…" : "Check"}
        </button>
      </div>
      {tools ? (
        <div className="stack-tight">
          <OkLine>
            It answered.{" "}
            {tools.length === 1 ? "1 tool" : `${tools.length} tools`}
          </OkLine>
          <ToolList tools={tools} />
        </div>
      ) : null}
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap">
        <button
          type="submit"
          className={primary ? "btn btn-primary" : "btn"}
          disabled={busy !== "" || !name.trim() || (needsKey && !apiKey.trim())}
        >
          {busy === "save" ? "Saving…" : editing ? "Save" : "Add Composio"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** Reads what a company publishes for personal agents. Saves nothing. */
function CompanyLookup({
  onFill,
}: {
  onFill(name: string, baseUrl: string): void;
}) {
  const ids = useId();
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offer, setOffer] = useState<CompanyOffer | null>(null);

  async function look(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOffer(null);
    try {
      setOffer(await api.lookupCompany(domain));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="stack" onSubmit={look}>
        <label className="field">
          <span className="field-label" id={`${ids}-domain`}>
            Site name
          </span>
          <input
            aria-labelledby={`${ids}-domain`}
            className="input mono"
            value={domain}
            placeholder="example.com"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setDomain(event.target.value)}
          />
          <span className="faint">
            Look up reads one public file from that site, with no key or cookie.
          </span>
        </label>
        <div className="wrap">
          <button
            type="submit"
            className="btn"
            disabled={busy || !domain.trim()}
          >
            {busy ? "Looking…" : "Look up"}
          </button>
        </div>
      </form>
      <ErrorLine>{error}</ErrorLine>
      {offer ? (
        <div className="stack-tight" aria-live="polite">
          <p>
            <span className="row-name">{offer.name}</span>{" "}
            <span className="faint mono">{offer.domain}</span>
          </p>
          <p className="dim">
            {offer.signIn
              ? "It offers sign-in to personal agents."
              : "It does not offer sign-in to personal agents."}
          </p>
          {offer.apis.length === 0 ? (
            <p className="dim">It lists no tools or interfaces.</p>
          ) : (
            <ul className="list card" aria-label="What it offers">
              {offer.apis.map((item) => (
                <li
                  key={`${item.type}:${item.url}`}
                  style={{ flexWrap: "wrap" }}
                >
                  <span className="grow stack-tight">
                    <span className="mono">{item.url}</span>
                    {item.description ? (
                      <span className="faint">{item.description}</span>
                    ) : null}
                  </span>
                  <span className="badge">
                    {item.type === "mcp" ? "Tools" : "API description"}
                  </span>
                  {item.type === "mcp" ? (
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Add ${offer.name} as a connection`}
                      onClick={() => onFill(offer.name.slice(0, 40), item.url)}
                    >
                      Add as a connection
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="faint">
            OpenStellarFirm cannot sign in to a company for you yet.
          </p>
        </div>
      ) : null}
    </div>
  );
}

interface ScreenProps {
  state: AppState;
  onChanged(): Promise<void>;
  /** Opens Settings, Mail, where the person's own mailboxes live. */
  onMail(): void;
}

/** The one form that is open at a time, so there is one lime button. */
type Open =
  | { kind: "edit"; id: string }
  | { kind: "catalog"; id: string }
  | { kind: "composio" }
  | { kind: "address"; n: number; name: string; baseUrl: string };

/** A name that no connection has yet: "GitHub", then "GitHub 2", and so on. */
function freeName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i += 1) {
    const next = `${base} ${i}`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return base;
}

export function ConnectionsScreen({ state, onChanged, onMail }: ScreenProps) {
  const [open, setOpen] = useState<Open | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [error, setError] = useState("");

  const names = state.connections.map((c) => c.name);
  const close = () => setOpen(null);
  const saved = () => {
    setOpen(null);
    void onChanged();
  };

  function fill(name: string, baseUrl: string) {
    setOpen({
      kind: "address",
      n: open?.kind === "address" ? open.n + 1 : 0,
      name,
      baseUrl,
    });
    document
      .getElementById("add-connection-title")
      ?.scrollIntoView({ block: "start" });
  }

  async function remove(id: string) {
    setError("");
    try {
      await api.removeConnection(id);
      setRemoving(null);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  /** Asks the service once with the saved key. Saves nothing. */
  async function check(connection: Connection) {
    setChecking(connection.id);
    setError("");
    try {
      const base = { id: connection.id, name: connection.name };
      const catalogId = catalogIdOf(connection.preset);
      const tools =
        connection.preset === "composio"
          ? await api.checkComposio(base)
          : catalogId
            ? await api.checkCatalog({ ...base, catalogId })
            : await api.checkConnection({
                ...base,
                baseUrl: connection.baseUrl,
              });
      const n = tools.length;
      setChecked((all) => ({
        ...all,
        [connection.id]: `It answered, with ${n === 1 ? "1 tool" : `${n} tools`}.`,
      }));
    } catch (e) {
      setChecked((all) => ({ ...all, [connection.id]: errorText(e) }));
    } finally {
      setChecking(null);
    }
  }

  const usedBy = (id: string) =>
    state.assistants.filter((a) => a.connections.includes(id));

  /** Opens one of the forms lower down and brings its section into view. */
  function openSection(next: Open, titleId: string) {
    setOpen(next);
    requestAnimationFrame(() =>
      document.getElementById(titleId)?.scrollIntoView({ block: "start" }),
    );
  }

  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title={pageTitle("connections")}>
          Every call asks you first, and what an assistant sends to a connection
          leaves this computer.
        </ScreenHead>
        <details className="how">
          <summary>How connections work</summary>
          <p className="faint">
            A connection lets an assistant use the tools of another service. You
            make a key in that service, and this app sends it only to that
            service, straight from this computer. You choose which assistants
            may use each connection, in each assistant's own settings. Every
            call asks you first and shows what would be sent. A tool the service
            says only reads can be allowed for good; every other tool asks every
            time. The services listed below let you make a key of your own; add
            the same one more than once if you have more than one account. This
            only shows what a company publishes about itself when you look it
            up.
          </p>
        </details>

        <section className="stack" aria-labelledby="connections-title">
          <h2 className="section-title" id="connections-title">
            Services you added
          </h2>
          {state.connections.length === 0 ? (
            <p className="dim">No services yet.</p>
          ) : (
            <ul className="list card">
              {state.connections.map((connection) => {
                const users = usedBy(connection.id);
                const entry = catalogEntry(catalogIdOf(connection.preset));
                const n = connection.tools.length;
                return (
                  <li key={connection.id} style={{ flexWrap: "wrap" }}>
                    <span className="grow stack-tight">
                      <span className="row-name">{connection.name}</span>
                      <span className="faint">
                        {serviceLabel(connection)}
                        {" · "}
                        {n === 1 ? "1 tool" : `${n} tools`}
                        {" · "}
                        {connection.hasKey ? "Key saved" : "No key saved"}
                      </span>
                      <span className="faint">
                        {users.length === 0
                          ? "No assistant uses it yet"
                          : `Used by ${users.map((a) => a.name).join(", ")}`}
                      </span>
                      {checked[connection.id] ? (
                        <span className="faint" role="status">
                          {checked[connection.id]}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      disabled={checking !== null}
                      aria-label={`Check ${connection.name}`}
                      onClick={() => void check(connection)}
                    >
                      {checking === connection.id ? "Checking…" : "Check"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`${open?.kind === "edit" && open.id === connection.id ? "Close" : "Edit"} ${connection.name}`}
                      aria-expanded={
                        open?.kind === "edit" && open.id === connection.id
                      }
                      onClick={() =>
                        setOpen(
                          open?.kind === "edit" && open.id === connection.id
                            ? null
                            : { kind: "edit", id: connection.id },
                        )
                      }
                    >
                      {open?.kind === "edit" && open.id === connection.id
                        ? "Close"
                        : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remove ${connection.name}`}
                      onClick={() => setRemoving(connection.id)}
                    >
                      Remove
                    </button>
                    {removing === connection.id ? (
                      <InlineConfirm
                        className="stack-tight list-confirm"
                        label={`Remove ${connection.name}`}
                        onClose={() => setRemoving(null)}
                      >
                        <p>
                          {users.length === 0
                            ? `Remove ${connection.name}? Its saved key is deleted.`
                            : `Remove ${connection.name}? ${users.map((a) => a.name).join(", ")} will no longer be able to use it. Its saved key is deleted.`}
                        </p>
                        <div className="wrap">
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void remove(connection.id)}
                          >
                            Yes, remove it
                          </button>
                          <button
                            data-autofocus
                            type="button"
                            className="btn"
                            onClick={() => setRemoving(null)}
                          >
                            Keep it
                          </button>
                        </div>
                      </InlineConfirm>
                    ) : null}
                    {open?.kind === "edit" && open.id === connection.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        {connection.preset === "composio" ? (
                          <ComposioForm
                            keychain={state.keychain}
                            editing={connection}
                            onSaved={saved}
                            onCancel={close}
                          />
                        ) : entry ? (
                          <CatalogForm
                            entry={entry}
                            keychain={state.keychain}
                            editing={connection}
                            onSaved={saved}
                            onCancel={close}
                          />
                        ) : (
                          <ConnectionForm
                            keychain={state.keychain}
                            editing={connection}
                            onSaved={saved}
                            onCancel={close}
                          />
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <ErrorLine>{error}</ErrorLine>
        </section>

        <section className="stack" aria-labelledby="your-mail-title">
          <h2 className="section-title" id="your-mail-title">
            Your mail
          </h2>
          <div className="card pad mail-card">
            <p className="dim">
              {state.mailAccounts.length === 0
                ? "Gmail, Outlook, iCloud or any IMAP mailbox, read only: an assistant can never send, delete or move mail."
                : `${state.mailAccounts.length === 1 ? "1 mailbox" : `${state.mailAccounts.length} mailboxes`} added, read only: an assistant can never send, delete or move mail.`}
            </p>
            <button type="button" className="btn" onClick={onMail}>
              {state.mailAccounts.length === 0 ? "Add a mailbox" : "Open Mail"}
            </button>
          </div>
        </section>

        <section className="stack" aria-labelledby="add-service-title">
          <h2 className="section-title" id="add-service-title">
            Add a service
          </h2>
          <ConnectionGallery
            onMail={onMail}
            connections={state.connections}
            openId={open?.kind === "catalog" ? open.id : null}
            onToggle={(id) => setOpen(id ? { kind: "catalog", id } : null)}
            renderForm={(entry) => (
              <CatalogForm
                entry={entry}
                keychain={state.keychain}
                suggestedName={freeName(entry.name, names)}
                onSaved={saved}
                onCancel={close}
              />
            )}
            onAddByAddress={() =>
              openSection(
                { kind: "address", n: 0, name: "", baseUrl: "" },
                "add-connection-title",
              )
            }
            onAddComposio={() =>
              openSection({ kind: "composio" }, "add-composio-title")
            }
          />
        </section>

        <section className="stack" aria-labelledby="add-composio-title">
          <h2 className="section-title" id="add-composio-title">
            Add Composio
          </h2>
          <p className="dim">
            Mail, calendars, Slack and more, through your own Composio account.
          </p>
          {open?.kind === "composio" ? (
            <div className="card pad">
              <ComposioForm
                keychain={state.keychain}
                onSaved={saved}
                onCancel={close}
              />
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => setOpen({ kind: "composio" })}
              >
                Add Composio
              </button>
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="add-connection-title">
          <h2 className="section-title" id="add-connection-title">
            Add a connection by address
          </h2>
          <p className="dim">
            For a server that is not in the list, or one on this computer.
          </p>
          {open?.kind === "address" ? (
            <div className="card pad">
              {open.name || open.baseUrl ? (
                <p className="dim" role="status">
                  Filled in from the company look-up, so check it before you add
                  it.
                </p>
              ) : null}
              <ConnectionForm
                key={open.n}
                keychain={state.keychain}
                prefill={{ name: open.name, baseUrl: open.baseUrl }}
                onSaved={saved}
                onCancel={close}
              />
            </div>
          ) : (
            <div>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setOpen({ kind: "address", n: 0, name: "", baseUrl: "" })
                }
              >
                Add by address
              </button>
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="lookup-title">
          <h2 className="section-title" id="lookup-title">
            Look up a company
          </h2>
          <p className="dim">
            See what a company offers to AI agents, without saving or connecting
            anything.
          </p>
          <div className="card pad">
            <CompanyLookup onFill={fill} />
          </div>
        </section>
      </div>
    </div>
  );
}
