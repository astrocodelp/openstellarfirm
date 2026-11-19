import { type FormEvent, useId, useState } from "react";
import type { AppState, MailAccount, MailCheck } from "../../shared/types";
import { api } from "./bridge";
import {
  ErrorLine,
  message as errorText,
  InlineConfirm,
  OkLine,
  ScreenHead,
} from "./ui";

const MAX_ACCOUNTS = 5;

interface FormProps {
  keychain: boolean;
  editing?: MailAccount;
  /** False while another form on the screen holds the one lime button. */
  primary?: boolean;
  onSaved(): void;
  onCancel?: () => void;
}

/** Adds a mail account, or changes one. The password is never shown again. */
function MailForm({
  keychain,
  editing,
  primary = true,
  onSaved,
  onCancel,
}: FormProps) {
  const ids = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [host, setHost] = useState(editing?.host ?? "");
  const [port, setPort] = useState(String(editing?.port ?? 993));
  const [username, setUsername] = useState(editing?.username ?? "");
  const [password, setPassword] = useState("");
  const [ownNetwork, setOwnNetwork] = useState(editing?.ownNetwork ?? false);
  const [found, setFound] = useState<MailCheck | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "save">("");
  const [error, setError] = useState("");

  const needsPassword = !editing?.hasPassword;
  const input = () => ({
    ...(editing ? { id: editing.id } : {}),
    name,
    host,
    port: Number(port),
    username,
    ownNetwork,
    password,
  });
  const incomplete =
    !name.trim() ||
    !host.trim() ||
    !username.trim() ||
    !/^\d{1,5}$/.test(port.trim()) ||
    (needsPassword && !password.trim());

  async function check() {
    setBusy("check");
    setError("");
    try {
      setFound(await api.checkMail(input()));
    } catch (e) {
      setFound(null);
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
      await api.saveMail(input());
      setPassword("");
      setFound(null);
      if (!editing) {
        setName("");
        setHost("");
        setPort("993");
        setUsername("");
        setOwnNetwork(false);
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
          placeholder="Work mail"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="wrap" style={{ alignItems: "flex-start" }}>
        <label className="field grow">
          <span className="field-label">Server (IMAP)</span>
          <input
            className="input mono"
            value={host}
            placeholder="imap.example.com"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setHost(event.target.value)}
          />
        </label>
        <label className="field" style={{ width: "7rem" }}>
          <span className="field-label">Port</span>
          <input
            className="input mono"
            value={port}
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Username</span>
        <input
          className="input mono"
          value={username}
          placeholder="you@example.com"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label" id={`${ids}-pw`}>
          App password
        </span>
        <input
          aria-labelledby={`${ids}-pw`}
          aria-describedby={`${ids}-pw-note`}
          className="input mono"
          type="password"
          value={password}
          placeholder={
            editing?.hasPassword ? "Saved. Leave empty to keep it." : ""
          }
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPassword(event.target.value)}
        />
        <span className="faint" id={`${ids}-pw-note`}>
          {keychain
            ? "Kept in this computer's keychain. It is sent only to this server, over a secure connection, and never shown again."
            : "This computer has no keychain, so a password cannot be saved here."}
        </span>
      </label>
      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          checked={ownNetwork}
          onChange={(event) => setOwnNetwork(event.target.checked)}
        />
        <span>This server is on my own network</span>
      </label>
      <p className="faint">
        Tick this only for a server at home or at work, on a private address.
        The connection is secure and its certificate is checked either way.
      </p>

      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy !== "" || incomplete}
          onClick={() => void check()}
        >
          {busy === "check" ? "Checking…" : "Check"}
        </button>
      </div>
      {found ? (
        <div className="stack-tight" aria-live="polite">
          <OkLine>
            Signed in.{" "}
            {found.folders.length === 1
              ? "1 folder"
              : `${found.folders.length + found.more} folders`}
          </OkLine>
          <ul className="list card" aria-label="Folders it found">
            {found.folders.map((folder) => (
              <li key={folder}>
                <span className="mono">{folder}</span>
              </li>
            ))}
          </ul>
          {found.more > 0 ? (
            <p className="faint">…and {found.more} more.</p>
          ) : null}
          <p className="faint">
            The check signed in, listed the folders and signed out. It read no
            message.
          </p>
        </div>
      ) : null}

      <ErrorLine id={`${ids}-error`}>{error}</ErrorLine>
      <div className="wrap">
        <button
          type="submit"
          className={primary ? "btn btn-primary" : "btn"}
          disabled={busy !== "" || incomplete}
          aria-describedby={error ? `${ids}-error` : undefined}
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

export function MailScreen({ state, onChanged, onBack }: ScreenProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const accounts = state.mailAccounts;

  async function remove(id: string) {
    setError("");
    try {
      await api.removeMail(id);
      setRemoving(null);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const usedBy = (id: string) =>
    state.assistants.filter((a) => (a.mail ?? []).includes(id));

  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title="Your mail" onBack={onBack}>
          Let an assistant read your mail, only when you approve. It can look
          through recent messages and read one at a time. It cannot send,
          answer, delete, move or mark anything, and it never opens an
          attachment. What it reads is sent to the model you chose, so with a
          model on this computer it stays here. You choose which assistants may
          use an account, in each assistant's own settings.
        </ScreenHead>

        <section className="stack" aria-labelledby="mail-help-title">
          <h2 className="section-title" id="mail-help-title">
            Before you add one
          </h2>
          <p className="dim">
            Use an app password made for this app, not your main password.
            Gmail, iCloud, Fastmail and many others let you make one in their
            account settings. Some providers, for example Microsoft 365, do not
            allow app passwords, and then this will not work.
          </p>
        </section>

        <section className="stack" aria-labelledby="mail-accounts-title">
          <h2 className="section-title" id="mail-accounts-title">
            Set up
          </h2>
          {accounts.length === 0 ? (
            <p className="dim">Nothing yet. Add an account below.</p>
          ) : (
            <ul className="list card">
              {accounts.map((account) => {
                const users = usedBy(account.id);
                return (
                  <li key={account.id} style={{ flexWrap: "wrap" }}>
                    <span className="grow stack-tight">
                      <span className="row-name">{account.name}</span>
                      <span className="faint mono">
                        {account.username} · {account.host}:{account.port}
                      </span>
                      <span className="faint">
                        {account.hasPassword
                          ? "Password saved in the keychain"
                          : "No password saved"}
                        {account.ownNetwork ? " · On your own network" : ""}
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
                      aria-expanded={editing === account.id}
                      aria-label={`${editing === account.id ? "Close" : "Edit"} ${account.name}`}
                      onClick={() =>
                        setEditing(editing === account.id ? null : account.id)
                      }
                    >
                      {editing === account.id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      aria-label={`Remove ${account.name}`}
                      onClick={() => setRemoving(account.id)}
                    >
                      Remove
                    </button>
                    {removing === account.id ? (
                      <InlineConfirm
                        className="stack-tight list-confirm"
                        label={`Remove ${account.name}`}
                        onClose={() => setRemoving(null)}
                      >
                        <p>
                          {users.length === 0
                            ? `Remove ${account.name}? Its saved password is deleted.`
                            : `Remove ${account.name}? ${users.map((a) => a.name).join(", ")} will no longer be able to read it. Its saved password is deleted.`}
                        </p>
                        <div className="wrap">
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => void remove(account.id)}
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
                    {editing === account.id ? (
                      <div style={{ flexBasis: "100%" }}>
                        <MailForm
                          keychain={state.keychain}
                          editing={account}
                          primary={false}
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

        <section className="stack" aria-labelledby="add-mail-title">
          <h2 className="section-title" id="add-mail-title">
            Add a mail account
          </h2>
          {accounts.length >= MAX_ACCOUNTS ? (
            <p className="dim">
              You have {MAX_ACCOUNTS} accounts, which is the most. Remove one to
              add another.
            </p>
          ) : (
            <div className="card pad">
              <MailForm
                keychain={state.keychain}
                onSaved={() => void onChanged()}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
