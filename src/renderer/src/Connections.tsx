import { type FormEvent, useId, useState } from "react";
import type { AppState, Connection, ConnectionTool } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText, OkLine } from "./ui";

function host(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

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
  onSaved(): void;
  onCancel?: () => void;
}

/** Adds a connection, or changes one. The tools always come from the server. */
function ConnectionForm({ keychain, editing, onSaved, onCancel }: FormProps) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
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
        <span className="field-label">Address</span>
        <input
          className="input mono"
          value={baseUrl}
          placeholder="https://tools.example.com/mcp"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <span className="faint">
          Starts with https://, or http:// for a server on this computer. No
          sign-in or “?” in it.
        </span>
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-key`}>
          Key, if it needs one
        </span>
        <input
          aria-labelledby={`${ids}-key`}
          className="input mono"
          type="password"
          value={apiKey}
          placeholder={editing?.hasKey ? "Saved. Leave empty to keep it." : ""}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
        />
        <span className="faint">
          {keychain
            ? "Kept in this computer's keychain. It is sent only to this address, and never shown again."
            : "This computer has no keychain, so a key cannot be saved here."}
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
          className="btn btn-primary"
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

interface ScreenProps {
  state: AppState;
  onChanged(): Promise<void>;
  onBack(): void;
}

export function ConnectionsScreen({ state, onChanged, onBack }: ScreenProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");

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

  const usedBy = (id: string) =>
    state.assistants.filter((a) => a.connections.includes(id));

  return (
    <div className="screen">
      <div className="screen-body">
        <div className="stack-tight">
          <div>
            <button type="button" className="btn" onClick={onBack}>
              Back to chats
            </button>
          </div>
          <h1 className="screen-title">Your connections</h1>
          <p className="dim">
            A connection lets an assistant use the tools of another service, by
            its web address. You choose which assistants may use it, in each
            assistant's own settings. Every call asks you first, and shows what
            would be sent. A tool the service says only reads can be allowed for
            good; every other tool asks every time. What an assistant sends to a
            connection leaves this computer.
          </p>
        </div>

        <section className="stack" aria-labelledby="connections-title">
          <h2 className="section-title" id="connections-title">
            Set up
          </h2>
          {state.connections.length === 0 ? (
            <p className="dim">Nothing yet. Add a connection below.</p>
          ) : (
            <ul className="list card">
              {state.connections.map((connection) => {
                const users = usedBy(connection.id);
                const reads = connection.tools.filter((t) => t.readOnly).length;
                return (
                  <li key={connection.id} style={{ flexWrap: "wrap" }}>
                    <span className="grow stack-tight">
                      <span className="row-name">{connection.name}</span>
                      <span className="faint mono">
                        {host(connection.baseUrl)}
                      </span>
                      <span className="faint">
                        {connection.tools.length === 1
                          ? "1 tool"
                          : `${connection.tools.length} tools`}
                        , {reads} of them {reads === 1 ? "reads" : "read"}
                        {" · "}
                        {connection.hasKey
                          ? "Key saved in the keychain"
                          : "No key saved"}
                      </span>
                      <span className="faint">
                        {users.length === 0
                          ? "No assistant uses it yet"
                          : `Used by ${users.map((a) => a.name).join(", ")}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        setEditing(
                          editing === connection.id ? null : connection.id,
                        )
                      }
                    >
                      {editing === connection.id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRemoving(connection.id)}
                    >
                      Remove
                    </button>
                    {removing === connection.id ? (
                      <div
                        className="stack-tight"
                        style={{ flexBasis: "100%" }}
                        role="alertdialog"
                        aria-label={`Remove ${connection.name}`}
                      >
                        <p>
                          {users.length === 0
                            ? `Remove ${connection.name}? Its saved key is deleted.`
                            : `Remove ${connection.name}? ${users.map((a) => a.name).join(", ")} will no longer be able to use it. Its saved key is deleted.`}
                        </p>
                        <div className="wrap">
                          <button
                            type="button"
                            className="btn"
                            onClick={() => void remove(connection.id)}
                          >
                            Yes, remove it
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setRemoving(null)}
                          >
                            Keep it
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {editing === connection.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        <ConnectionForm
                          keychain={state.keychain}
                          editing={connection}
                          onSaved={() => {
                            setEditing(null);
                            void onChanged();
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <ErrorLine>{error}</ErrorLine>
        </section>

        <section className="stack" aria-labelledby="add-connection-title">
          <h2 className="section-title" id="add-connection-title">
            Add a connection
          </h2>
          <div className="card" style={{ padding: "1rem" }}>
            <ConnectionForm
              keychain={state.keychain}
              onSaved={() => void onChanged()}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
