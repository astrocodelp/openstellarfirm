import { type FormEvent, useId, useState } from "react";
import { COLORS, PETS } from "../../shared/catalog";
import type { ComputerSettings } from "../../shared/computer";
import type { OwnSkill } from "../../shared/own-skills";
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
import { ConnectionPicker } from "./ConnectionPicker";
import { MemorySection } from "./Memory";
import { PersonaGallery } from "./PersonaGallery";
import type { Persona } from "./personas";
import { RecordSkill } from "./RecordSkill";
import { SkillPicker } from "./SkillPicker";
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
  /** The person's own skills, such as ones drafted from a recording. */
  ownSkills?: OwnSkill[];
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
  const [persona, setPersona] = useState<Persona>();
  const ids = useId();
  const source = sources.find((s) => s.id === sourceId);

  function toggle(id: string) {
    setSkills((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }

  /** Fills the look, brief and skills. Nothing is saved until the person saves. */
  function startFrom(picked: Persona) {
    const a = picked.assistant;
    setPersona(picked);
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
      <form className="screen assistant-form" onSubmit={save}>
        <div className="screen-body">
          <ScreenHead
            title={assistant ? "Make it yours" : "New assistant"}
            onBack={props.onCancel}
          >
            Saved on this computer.
          </ScreenHead>

          {!assistant ? (
            <PersonaGallery used={persona} onUse={startFrom} />
          ) : null}

          <section className="stack" aria-labelledby={`${ids}-who`}>
            <h2 className="section-title" id={`${ids}-who`}>
              Who it is
            </h2>
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
                <span className="field-label" id={`${ids}-group`}>
                  Group
                </span>
                <input
                  className="input"
                  value={group}
                  maxLength={40}
                  aria-labelledby={`${ids}-group`}
                  aria-describedby={`${ids}-group-hint`}
                  onChange={(event) => setGroup(event.target.value)}
                />
                <span className="faint" id={`${ids}-group-hint`}>
                  Its heading in the sidebar.
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
              <span className="field-label" id={`${ids}-brief`}>
                What it does
              </span>
              <span className="faint" id={`${ids}-brief-hint`}>
                Brief it like a new colleague.
              </span>
              <textarea
                aria-labelledby={`${ids}-brief`}
                aria-describedby={`${ids}-brief-hint`}
                className="input"
                rows={5}
                value={brief}
                maxLength={4000}
                onChange={(event) => setBrief(event.target.value)}
              />
            </label>

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
                      {/* Two sources can share a name (two Ollama models): the model tells them apart. */}
                      {sources.some((o) => o.id !== s.id && o.name === s.name)
                        ? `${s.name} · ${s.model}`
                        : s.name}
                    </option>
                  ))}
                </select>
              </label>
              {source ? (
                <label className="field grow">
                  <span className="field-label" id={`${ids}-model`}>
                    A model of its own
                  </span>
                  <input
                    aria-labelledby={`${ids}-model`}
                    aria-describedby={`${ids}-model-hint`}
                    className="input mono"
                    value={model}
                    placeholder={source.model}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => setModel(event.target.value)}
                  />
                  <span className="faint" id={`${ids}-model-hint`}>
                    Leave empty to use {source.model}.
                  </span>
                </label>
              ) : null}
            </div>
          </section>

          <section className="stack">
            <SkillPicker
              selected={skills}
              onToggle={toggle}
              own={props.ownSkills}
              onOwnChanged={props.onChanged}
            />

            {assistant ? (
              <RecordSkill
                assistant={assistant}
                sources={sources}
                onSaved={(skill, ticked) => {
                  if (ticked)
                    setSkills((current) =>
                      current.includes(skill.id)
                        ? current
                        : [...current, skill.id],
                    );
                  props.onChanged();
                }}
              />
            ) : (
              <p className="faint">
                Save it first to record how you do a task.
              </p>
            )}
          </section>

          <section className="stack" aria-labelledby="access-title">
            <div className="stack-tight">
              <h2 className="section-title" id="access-title">
                What it can use
              </h2>
              <p className="faint">
                It never changes or deletes your files, and what it reads goes
                to the model you chose.
              </p>
            </div>

            <div className="stack-tight">
              <label className="choice" style={{ alignSelf: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={web}
                  aria-describedby={`${ids}-web-hint`}
                  onChange={(event) => setWeb(event.target.checked)}
                />
                <span>Read web pages</span>
              </label>
              <span className="faint" id={`${ids}-web-hint`}>
                It asks before each new site, and when an address carries extra
                text.
              </span>
            </div>

            <div className="stack-tight">
              <label className="choice" style={{ alignSelf: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={screen}
                  aria-describedby={`${ids}-screen-hint`}
                  onChange={(event) => setScreen(event.target.checked)}
                />
                <span>Can look at my screen</span>
              </label>
              <span className="faint" id={`${ids}-screen-hint`}>
                It asks each time and sends all that is visible to the model, so
                close anything private.
              </span>
            </div>

            <div className="stack-tight">
              <h3 className="field-label">Folders</h3>
              {assistant ? (
                <>
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
                            aria-label={`Remove ${folder}`}
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
                      onClick={() =>
                        void run(() => api.addFolder(assistant.id))
                      }
                    >
                      Add a folder
                    </button>
                  </div>
                </>
              ) : (
                <p className="faint">Save it first to add folders.</p>
              )}
            </div>

            {assistant && assistant.sites.length > 0 ? (
              <div className="stack-tight">
                <h3 className="field-label">Sites</h3>
                <ul className="list card" aria-label="Sites it may always read">
                  {assistant.sites.map((site) => (
                    <li key={site}>
                      <span className="grow mono">{site}</span>
                      <span className="faint">Always allowed</span>
                      <button
                        type="button"
                        className="btn"
                        aria-label={`Remove ${site}`}
                        onClick={() =>
                          void run(() => api.removeSite(assistant.id, site))
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <fieldset className="stack-tight plain">
              <legend className="field-label">Connections</legend>
              {connections.length === 0 ? (
                <p className="faint">None yet: add one from the sidebar.</p>
              ) : (
                <>
                  <p className="faint">Each tool call asks you first.</p>
                  <ConnectionPicker
                    connections={connections}
                    chosen={connectionIds}
                    onChange={setConnectionIds}
                  />
                </>
              )}
              {assistant && assistant.connectionTools.length > 0 ? (
                <ul className="list card" aria-label="Reads it may always use">
                  {assistant.connectionTools.map((key) => {
                    const at = key.indexOf(":");
                    const connectionId = key.slice(0, at);
                    const tool = key.slice(at + 1);
                    const name =
                      connections.find((c) => c.id === connectionId)?.name ??
                      "";
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
                          aria-label={`Remove ${name ? `${name}: ` : ""}${tool}`}
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

            <fieldset className="stack-tight plain">
              <legend className="field-label">Mail</legend>
              {mailAccounts.length === 0 ? (
                <p className="faint">
                  None yet: add an account from the sidebar.
                </p>
              ) : (
                <>
                  <p className="faint">
                    Read only, and each look asks you first.
                  </p>
                  <div className="wrap">
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
                        aria-label={`Remove ${
                          mailAccounts.find((m) => m.id === accountId)?.name ??
                          "a mail account"
                        }`}
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

            <fieldset className="stack-tight plain">
              <legend className="field-label">
                Other assistants it can ask
              </legend>
              {others.length === 0 ? (
                <p className="faint">Make another assistant first.</p>
              ) : (
                <>
                  <div className="wrap">
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
                  <details className="how">
                    <summary>How asking works</summary>
                    <p className="faint">
                      It asks one question at a time. The one asked answers with
                      its own brief, skills, tools and model, and sees only the
                      question, not this chat. The question goes to that
                      assistant's model, and what it reads to answer comes back
                      to this one's model. A step that needs your Approve shows
                      in this chat and says whose step it is. It cannot ask a
                      third assistant.
                    </p>
                  </details>
                </>
              )}
            </fieldset>
          </section>

          <MemorySection assistant={assistant} />

          <section className="stack" aria-labelledby={`${ids}-computer`}>
            <h2 className="section-title" id={`${ids}-computer`}>
              Its computer
            </h2>
            <ComputerChoice value={computer} onChange={setComputer} />
          </section>

          <div className="form-actions stack-tight">
            <ErrorLine id={`${ids}-error`}>{error}</ErrorLine>
            <div className="wrap">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !name.trim()}
                aria-describedby={error ? `${ids}-error` : undefined}
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </div>

          {assistant ? (
            <section className="stack form-remove" aria-label="Remove">
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
                    className="link-btn link-danger"
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
                  Opens stellarfirm.ai, a separate service, with its saved name,
                  look and brief. You decide there whether to hire it.
                </p>
                <p className="faint">
                  Its chats, keys, folders and sites stay here.
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
            <p className="faint">The file never holds your keys.</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
