import { type FormEvent, useState } from "react";
import { COLORS, PETS, SKILLS } from "../../shared/catalog";
import type {
  Assistant,
  ModelSource,
  PetColor,
  PetId,
} from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText, Icon, OkLine, Pet } from "./ui";

interface AssistantFormProps {
  /** The assistant to change; none makes a new one. */
  assistant: Assistant | undefined;
  sources: ModelSource[];
  onSaved(assistant: Assistant): void;
  onRemoved(): void;
  onCancel(): void;
}

export function AssistantForm({
  assistant,
  sources,
  onSaved,
  onRemoved,
  onCancel,
}: AssistantFormProps) {
  const [name, setName] = useState(assistant?.name ?? "");
  const [group, setGroup] = useState(assistant?.group ?? "Personal");
  const [pet, setPet] = useState<PetId>(assistant?.pet ?? "glim");
  const [color, setColor] = useState<PetColor>(assistant?.color ?? "lime");
  const [brief, setBrief] = useState(assistant?.brief ?? "");
  const [skills, setSkills] = useState<string[]>(assistant?.skills ?? []);
  const [sourceId, setSourceId] = useState(assistant?.sourceId ?? "");
  const [model, setModel] = useState(assistant?.model ?? "");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const source = sources.find((s) => s.id === sourceId);

  function toggle(id: string) {
    setSkills((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api.saveAssistant({
          ...(assistant ? { id: assistant.id } : {}),
          name,
          group,
          pet,
          color,
          brief,
          skills,
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

  async function exportFile() {
    if (!assistant) return;
    setError("");
    setNote("");
    try {
      if (await api.exportAssistant(assistant.id)) setNote("Saved the file");
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove() {
    if (!assistant) return;
    try {
      await api.removeAssistant(assistant.id);
      onRemoved();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="form-layout">
      <form className="screen" onSubmit={save}>
        <div className="screen-body">
          <div className="stack-tight">
            <h1 className="screen-title">
              {assistant ? "Make it yours" : "New assistant"}
            </h1>
            <p className="dim">Everything here is saved on this computer.</p>
          </div>

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

          <fieldset
            className="stack"
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <legend
              className="field-label"
              style={{ padding: 0, marginBottom: "0.5rem" }}
            >
              Look
            </legend>
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
                    style={{ background: c.hex }}
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

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend
              className="field-label"
              style={{ padding: 0, marginBottom: "0.5rem" }}
            >
              Skills
            </legend>
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
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>

          {assistant ? (
            <section className="stack" aria-label="Remove">
              {removing ? (
                <div
                  className="card stack"
                  style={{ padding: "1rem" }}
                  role="alertdialog"
                  aria-label={`Remove ${assistant.name}`}
                >
                  <p>
                    Remove {assistant.name} and its chat from this computer?
                    This cannot be undone.
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
                      type="button"
                      className="btn"
                      onClick={() => setRemoving(false)}
                    >
                      Keep it
                    </button>
                  </div>
                </div>
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
          <div className="stack" style={{ marginTop: "auto", width: "100%" }}>
            <button
              type="button"
              className="btn"
              onClick={() => void exportFile()}
            >
              <Icon name="download" />
              Export as a file
            </button>
            {note ? <OkLine>{note}</OkLine> : null}
            <p className="faint">
              Share it with anyone who runs StellarFirm Open. Keys and models
              are never in the file.
            </p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
