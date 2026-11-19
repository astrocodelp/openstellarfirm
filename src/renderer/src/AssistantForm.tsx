import { type FormEvent, useState } from "react";
import { COLORS, PETS, SKILLS } from "../../shared/catalog";
import type { ComputerSettings } from "../../shared/computer";
import { serviceLabel } from "../../shared/connection-catalog";
import type {
  Assistant,
  Connection,
  MailAccount,
  ModelSource,
  PetColor,
  PetId,
} from "../../shared/types";
import { api } from "./bridge";
import { ComputerChoice } from "./Computer";
import { PERSONAS } from "./personas";
import {
  ErrorLine,
  message as errorText,
  Icon,
  InlineConfirm,
  OkLine,
  Pet,
  ScreenHead,
} from "./ui";

interface AssistantFormProps {
  /** The assistant to change; none makes a new one. */
  assistant: Assistant | undefined;
  sources: ModelSource[];
  connections: Connection[];
  mailAccounts: MailAccount[];
  /** Every assistant, so the person can pick the ones this one may ask. */
  assistants: Assistant[];
  onSaved(assistant: Assistant): void;
  /** Folders or sites changed; the form stays open. */
  onChanged(): void;
  onRemoved(): void;
  onCancel(): void;
}

export function AssistantForm(props: AssistantFormProps) {
  const { assistant, sources, connections, mailAccounts } = props;
  const others = props.assistants.filter((a) => a.id !== assistant?.id);
  const [name, setName] = useState(assistant?.name ?? "");
  const [group, setGroup] = useState(assistant?.group ?? "Personal");
  const [pet, setPet] = useState<PetId>(assistant?.pet ?? "glim");
  const [color, setColor] = useState<PetColor>(assistant?.color ?? "lime");
  const [brief, setBrief] = useState(assistant?.brief ?? "");
  const [skills, setSkills] = useState<string[]>(assistant?.skills ?? []);
  const [web, setWeb] = useState(assistant?.web ?? false);
  const [screen, setScreen] = useState(assistant?.screen ?? false);
  const [computer, setComputer] = useState<ComputerSettings | null>(
    assistant?.computer ?? null,
  );
  const [connectionIds, setConnectionIds] = useState<string[]>(
    assistant?.connections ?? [],
  );
  const [mailIds, setMailIds] = useState<string[]>(assistant?.mail ?? []);
  const [canAsk, setCanAsk] = useState<string[]>(assistant?.canAsk ?? []);
  const [sourceId, setSourceId] = useState(assistant?.sourceId ?? "");
  const [model, setModel] = useState(assistant?.model ?? "");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [persona, setPersona] = useState("");
  const source = sources.find((s) => s.id === sourceId);

  function toggle(id: string) {
    setSkills((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }

  /** Fills the look, brief and skills. Nothing is saved until the person saves. */
  function startFrom(index: number) {
    const picked = PERSONAS[index];
    if (!picked) return;
    const a = picked.assistant;
    setPersona(a.name);
    setName(a.name);
    setGroup(a.group);
    setPet(a.pet);
    setColor(a.color);
    setBrief(a.brief);
    setSkills(a.skills);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      props.onSaved(
        await api.saveAssistant({
          ...(assistant ? { id: assistant.id } : {}),
          name,
          group,
          pet,
          color,
          brief,
          skills,
          web,
          screen,
          computer,
          connections: connectionIds,
          mail: mailIds,
          canAsk,
          ...(sourceId ? { sourceId } : {}),
          ...(sourceId && model.trim() ? { model: model.trim() } : {}),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** Runs one small change (a folder, a site, a file) and reports how it went. */
  async function run(action: () => Promise<unknown>, done?: string) {
    setError("");
    setNote("");
    try {
      const result = await action();
      if (result !== null && result !== false) {
        if (done) setNote(done);
        props.onChanged();
      }
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    if (!assistant) return;
    try {
      await api.removeAssistant(assistant.id);
      props.onRemoved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="form-layout">
      <form className="screen" onSubmit={save}>
        <div className="screen-body">
          <ScreenHead
            title={assistant ? "Make it yours" : "New assistant"}
            onBack={props.onCancel}
          >
            Everything here is saved on this computer.
          </ScreenHead>

          {!assistant && PERSONAS.length > 0 ? (
            <fieldset className="stack plain">
              <legend className="field-label">Start from a persona</legend>
              <div className="wrap">
                {PERSONAS.map((p, index) => (
                  <button
                    key={p.assistant.name}
                    type="button"
                    className="choice persona"
                    aria-pressed={p.assistant.name === persona}
                    onClick={() => startFrom(index)}
                  >
                    {p.assistant.name}
                  </button>
                ))}
              </div>
              <p className="persona-note" aria-live="polite">
                {PERSONAS.find((p) => p.assistant.name === persona)?.summary ||
                  "A starting point only. Change anything below before you save."}
              </p>
            </fieldset>
          ) : null}

          <div className="wrap" style={{ alignItems: "flex-start" }}>
            <label className="field grow">
              <span className="field-label">Name</span>
              <input
                className="input"
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="field grow">
              <span className="field-label">Group</span>
              <input
                className="input"
                value={group}
                maxLength={40}
                onChange={(event) => setGroup(event.target.value)}
              />
              <span className="faint">
                The heading it sits under in the sidebar, such as Work or Home.
              </span>
            </label>
          </div>

          <fieldset className="stack plain">
            <legend className="field-label">Look</legend>
            <div className="wrap">
              {PETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="choice pet-choice"
                  aria-pressed={p.id === pet}
                  onClick={() => setPet(p.id)}
                >
                  <Pet pet={p.id} color={color} size={44} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
            <div className="wrap">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="choice"
                  aria-pressed={c.id === color}
                  onClick={() => setColor(c.id)}
                >
                  <span
                    className="swatch"
                    style={{ background: `var(--pet-${c.id})` }}
                    aria-hidden="true"
                  />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span className="field-label">What it does</span>
            <span className="faint">
              Say it the way you'd brief a new colleague.
            </span>
            <textarea
              className="input"
              rows={5}
              value={brief}
              maxLength={4000}
              onChange={(event) => setBrief(event.target.value)}
            />
          </label>

          <fieldset className="plain">
            <legend className="field-label">Skills</legend>
            <div className="wrap">
              {SKILLS.map((skill) => (
                <label key={skill.id} className="choice">
                  <input
                    type="checkbox"
                    checked={skills.includes(skill.id)}
                    onChange={() => toggle(skill.id)}
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <section className="stack" aria-labelledby="access-title">
            <div className="stack-tight">
              <h2 className="section-title" id="access-title">
                What it can use
              </h2>
              <p className="faint">
                It can never change, replace, move or delete a file. What it
                reads is sent to the model you chose, so with a model on this
                computer it stays here.
              </p>
            </div>

            <label className="choice" style={{ alignSelf: "flex-start" }}>
              <input
                type="checkbox"
                checked={web}
                onChange={(event) => setWeb(event.target.checked)}
              />
              <span>Read web pages</span>
            </label>
            <p className="faint">
              It asks you before it reaches a site for the first time, and every
              time an address carries extra text.
            </p>

            <label className="choice" style={{ alignSelf: "flex-start" }}>
              <input
                type="checkbox"
                checked={screen}
                onChange={(event) => setScreen(event.target.checked)}
              />
              <span>Can look at my screen</span>
            </label>
            <p className="faint">
              Each time, it asks first, and takes one picture of your screen
              only after you approve. Everything visible goes to the model you
              chose, so close anything private first.
            </p>

            <ComputerChoice value={computer} onChange={setComputer} />

            {assistant ? (
              <>
                {assistant.sites.length > 0 ? (
                  <ul
                    className="list card"
                    aria-label="Sites it may always read"
                  >
                    {assistant.sites.map((site) => (
                      <li key={site}>
                        <span className="grow mono">{site}</span>
                        <span className="faint">Always allowed</span>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            void run(() => api.removeSite(assistant.id, site))
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {assistant.folders.length > 0 ? (
                  <ul className="list card" aria-label="Folders it may use">
                    {assistant.folders.map((folder) => (
                      <li key={folder}>
                        <Icon name="folder" size={18} />
                        <span className="grow stack-tight">
                          <span className="mono">{folder}</span>
                          <span className="faint">
                            Reads files and adds new ones
                          </span>
                        </span>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            void run(() =>
                              api.removeFolder(assistant.id, folder),
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void run(() => api.addFolder(assistant.id))}
                  >
                    Add a folder
                  </button>
                </div>
              </>
            ) : (
              <p className="faint">
                Save it first. Then you can pick the folders it may use.
              </p>
            )}
          </section>

          <fieldset className="stack-tight">
            <legend className="section-title">Connections</legend>
            {connections.length === 0 ? (
              <p className="faint">
                Add a connection from the sidebar, then pick it here.
              </p>
            ) : (
              <>
                <p className="faint">
                  The tools of these connections are offered to this assistant.
                  Each call still asks you first.
                </p>
                <div className="stack-tight">
                  {connections.map((connection) => (
                    <label className="choice" key={connection.id}>
                      <input
                        type="checkbox"
                        checked={connectionIds.includes(connection.id)}
                        onChange={(event) =>
                          setConnectionIds((ids) =>
                            event.target.checked
                              ? [...ids, connection.id]
                              : ids.filter((id) => id !== connection.id),
                          )
                        }
                      />
                      <span>
                        {connection.name}
                        <span className="faint">
                          {" · "}
                          {serviceLabel(connection)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {assistant && assistant.connectionTools.length > 0 ? (
              <ul className="list card" aria-label="Reads it may always use">
                {assistant.connectionTools.map((key) => {
                  const at = key.indexOf(":");
                  const connectionId = key.slice(0, at);
                  const tool = key.slice(at + 1);
                  const name =
                    connections.find((c) => c.id === connectionId)?.name ?? "";
                  return (
                    <li key={key}>
                      <span className="grow mono">
                        {name ? `${name}: ` : ""}
                        {tool}
                      </span>
                      <span className="faint">Always allowed</span>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          void run(() =>
                            api.removeConnectionTool(
                              assistant.id,
                              connectionId,
                              tool,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </fieldset>

          <fieldset className="stack-tight">
            <legend className="section-title">Mail</legend>
            {mailAccounts.length === 0 ? (
              <p className="faint">
                Add a mail account from the sidebar, then pick it here.
              </p>
            ) : (
              <>
                <p className="faint">
                  This assistant may read the mail of the accounts you tick. It
                  can only read: it cannot send, delete, move or mark anything.
                  Each look asks you first, and what it reads goes to the model
                  you chose.
                </p>
                <div className="stack-tight">
                  {mailAccounts.map((account) => (
                    <label className="choice" key={account.id}>
                      <input
                        type="checkbox"
                        checked={mailIds.includes(account.id)}
                        onChange={(event) =>
                          setMailIds((ids) =>
                            event.target.checked
                              ? [...ids, account.id]
                              : ids.filter((id) => id !== account.id),
                          )
                        }
                      />
                      <span>{account.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
            {assistant && (assistant.mailReads ?? []).length > 0 ? (
              <ul className="list card" aria-label="Mail it may always read">
                {(assistant.mailReads ?? []).map((accountId) => (
                  <li key={accountId}>
                    <span className="grow">
                      {mailAccounts.find((m) => m.id === accountId)?.name ??
                        "A mail account"}
                    </span>
                    <span className="faint">Always allowed</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        void run(() =>
                          api.removeMailRead(assistant.id, accountId),
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>
          <fieldset className="stack-tight">
            <legend className="section-title">Can ask</legend>
            {others.length === 0 ? (
              <p className="faint">
                Make another assistant first. Then you can let this one ask it.
              </p>
            ) : (
              <>
                <p className="faint">
                  This assistant may ask the ones you tick one question at a
                  time. The one that is asked answers with its own brief,
                  skills, tools and model, and sees only the question, not this
                  chat. A question, and anything in it, goes to the other
                  assistant's model, and what the other assistant reads to
                  answer comes back here and goes to this assistant's model. If
                  it needs your Approve for a step, the card shows in this chat
                  and says whose step it is. It cannot ask a third assistant.
                </p>
                <div className="stack-tight">
                  {others.map((other) => (
                    <label className="choice" key={other.id}>
                      <input
                        type="checkbox"
                        checked={canAsk.includes(other.id)}
                        onChange={(event) =>
                          setCanAsk((ids) =>
                            event.target.checked
                              ? [...ids, other.id]
                              : ids.filter((id) => id !== other.id),
                          )
                        }
                      />
                      <span>{other.name}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>

          <div className="wrap" style={{ alignItems: "flex-start" }}>
            <label className="field grow">
              <span className="field-label">Model</span>
              <select
                className="input"
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">Use the default</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {source ? (
              <label className="field grow">
                <span className="field-label">A model of its own</span>
                <input
                  className="input mono"
                  value={model}
                  placeholder={source.model}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setModel(event.target.value)}
                />
                <span className="faint">
                  Leave empty to use {source.model}.
                </span>
              </label>
            ) : null}
          </div>

          <ErrorLine>{error}</ErrorLine>

          <div className="wrap">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn" onClick={props.onCancel}>
              Cancel
            </button>
          </div>

          {assistant ? (
            <section className="stack" aria-label="Remove">
              {removing ? (
                <InlineConfirm
                  className="card stack pad"
                  label={`Remove ${assistant.name}`}
                  onClose={() => setRemoving(false)}
                >
                  <p>
                    Remove {assistant.name} and its chat from this computer?
                    This cannot be undone. Files in its folders stay.
                  </p>
                  <div className="wrap">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => void remove()}
                    >
                      Remove
                    </button>
                    <button
                      data-autofocus
                      type="button"
                      className="btn"
                      onClick={() => setRemoving(false)}
                    >
                      Keep it
                    </button>
                  </div>
                </InlineConfirm>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setRemoving(true)}
                  >
                    Remove this assistant
                  </button>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </form>

      <aside className="preview" aria-label="Preview">
        <span className="faint">Preview</span>
        <Pet pet={pet} color={color} size={148} />
        <div className="preview-name">{name.trim() || "Your assistant"}</div>
        <span className="faint">
          {PETS.find((p) => p.id === pet)?.name} ·{" "}
          {skills.length === 1 ? "1 skill" : `${skills.length} skills`}
        </span>
        {assistant ? (
          <div className="stack preview-actions">
            {note ? <OkLine>{note}</OkLine> : null}
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(
                  () => api.exportAssistant(assistant.id),
                  "Saved the file",
                )
              }
            >
              <Icon name="download" />
              Export as a file
            </button>
            {copying ? (
              <InlineConfirm
                className="card stack pad"
                label="Copy to StellarFirm cloud"
                onClose={() => setCopying(false)}
              >
                <p>
                  This opens stellarfirm.ai in your browser with this
                  assistant's saved name, look and brief. You decide there
                  whether to hire it.
                </p>
                <p className="faint">
                  Not copied: its chats, your model keys, its folders and sites.
                  StellarFirm is a separate service with its own account and
                  plans.
                </p>
                <div className="wrap" style={{ justifyContent: "center" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setCopying(false);
                      void run(
                        () => api.openCloud("copy", assistant.id),
                        "Opened in your browser",
                      );
                    }}
                  >
                    Open StellarFirm
                    <Icon name="external" size={14} />
                  </button>
                  <button
                    data-autofocus
                    type="button"
                    className="btn"
                    onClick={() => setCopying(false)}
                  >
                    Cancel
                  </button>
                </div>
              </InlineConfirm>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => setCopying(true)}
              >
                <Icon name="cloud" />
                Copy to StellarFirm cloud
              </button>
            )}
            <p className="faint">
              A file can be shared with anyone who runs OpenStellarFirm. Keys
              and models are never in it.
            </p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
