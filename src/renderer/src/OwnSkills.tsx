import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  checkOwnSkillInput,
  MAX_OWN_DESCRIPTION,
  MAX_OWN_LINE,
  MAX_OWN_LINES,
  MAX_OWN_NAME,
  type OwnSkill,
  type OwnSkillDraft,
} from "../../shared/own-skills";
import { api } from "./bridge";
import { ErrorLine, message as errorText, InlineConfirm } from "./ui";
import "./record.css";

/**
 * The person's own skills: the editor they read and change a draft in, and
 * the row each one has in the skills picker, with Edit and Delete. A skill is
 * guidance, never access, and nothing is kept until the person saves.
 */

/**
 * A dialog over the page, from the system's own `<dialog>`: focus stays in it,
 * Escape asks to close, and focus goes back to what opened it. It is drawn at
 * the end of the page, so it is never inside another form.
 */
export function Modal({
  labelledBy,
  onClose,
  className,
  children,
}: {
  labelledBy: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  const mounted = useRef(true);
  useEffect(() => {
    const dialog = ref.current;
    mounted.current = true;
    if (dialog && !dialog.open) dialog.showModal();
    const back = opener.current;
    return () => {
      mounted.current = false;
      dialog?.close();
      if (back instanceof HTMLElement && back.isConnected)
        back.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`modal ${className ?? ""}`}
      aria-labelledby={labelledBy}
      // Escape is handled here, so the browser never closes the dialog on its
      // own (it may, on a second Escape, whatever the cancel event says).
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
      }}
      onClose={() => {
        // Closed by the browser while still shown: open it again and ask.
        const dialog = ref.current;
        if (!mounted.current || !dialog || dialog.open) return;
        dialog.showModal();
        onClose();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}

/** The lines as the person typed them, one guidance line each. */
function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function OwnSkillEditor({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
  cancelLabel = "Cancel",
  children,
}: {
  initial: OwnSkillDraft;
  submitLabel: string;
  busy?: boolean;
  onSubmit(draft: OwnSkillDraft): void | Promise<void>;
  onCancel(): void;
  cancelLabel?: string;
  /** Anything to show above the buttons, such as a tick for this assistant. */
  children?: ReactNode;
}) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [lines, setLines] = useState(initial.lines.join("\n"));
  const [error, setError] = useState("");
  const count = linesOf(lines).length;
  const longest = Math.max(0, ...linesOf(lines).map((line) => line.length));

  async function submit(event: FormEvent) {
    event.preventDefault();
    // The editor is drawn in a dialog at the end of the page, but React still
    // passes its submit up to the assistant form around it. It stops here.
    event.stopPropagation();
    setError("");
    try {
      const checked = checkOwnSkillInput({
        name,
        description,
        lines: linesOf(lines),
      });
      await onSubmit(checked);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          value={name}
          maxLength={MAX_OWN_NAME}
          spellCheck
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">What it is for, in one line</span>
        <input
          className="input"
          value={description}
          maxLength={MAX_OWN_DESCRIPTION}
          spellCheck
          autoComplete="off"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-lines`}>
          How to do it
        </label>
        <span className="faint" id={`${id}-lines-help`}>
          One line of guidance per line, up to {MAX_OWN_LINES}, each up to{" "}
          {MAX_OWN_LINE} characters. It tells the assistant how to work; it
          never gives it access to anything.
        </span>
        <textarea
          id={`${id}-lines`}
          className="input"
          rows={8}
          value={lines}
          aria-describedby={`${id}-lines-help ${id}-lines-count`}
          onChange={(event) => setLines(event.target.value)}
        />
        <span
          className={`faint record-num${count > MAX_OWN_LINES || longest > MAX_OWN_LINE ? " record-over" : ""}`}
          id={`${id}-lines-count`}
        >
          {count} of {MAX_OWN_LINES} lines
          {longest > MAX_OWN_LINE ? ` · one line is ${longest} characters` : ""}
        </span>
      </div>
      {children}
      <ErrorLine>{error}</ErrorLine>
      <div className="wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

/** One of the person's own skills in the picker: a tick, Edit and Delete. */
export function OwnSkillRow({
  skill,
  checked,
  disabled,
  onToggle,
  onChanged,
}: {
  skill: OwnSkill;
  checked: boolean;
  disabled: boolean;
  onToggle(): void;
  /** Saved or deleted: the app's state is read again. */
  onChanged(): void;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setError("");
    try {
      await api.removeOwnSkill(skill.id);
      if (checked) onToggle();
      setRemoving(false);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <li className="own-skill">
      <div className="own-skill-row">
        <label className="skill-option grow">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggle}
          />
          <span className="stack-tight skill-option-text">
            <span>{skill.name}</span>
            <span className="faint">{skill.description}</span>
          </span>
        </label>
        {removing ? null : (
          <span className="own-skill-actions">
            <button
              type="button"
              className="link-btn"
              aria-label={`Edit ${skill.name}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="link-btn own-skill-delete"
              aria-label={`Delete ${skill.name}`}
              onClick={() => setRemoving(true)}
            >
              Delete
            </button>
          </span>
        )}
      </div>
      {removing ? (
        <InlineConfirm
          className="card stack pad own-skill-confirm"
          label={`Delete ${skill.name}`}
          onClose={() => setRemoving(false)}
        >
          <p>
            Delete “{skill.name}”? It is taken off every assistant that has it
            ticked. This cannot be undone.
          </p>
          <div className="wrap">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void remove()}
            >
              Delete
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
      ) : null}
      <ErrorLine>{error}</ErrorLine>
      {editing ? (
        <Modal labelledBy={titleId} onClose={() => setEditing(false)}>
          <div className="modal-body stack">
            <h2 className="section-title" id={titleId}>
              Edit your skill
            </h2>
            <OwnSkillEditor
              initial={skill}
              submitLabel="Save"
              busy={busy}
              onCancel={() => setEditing(false)}
              onSubmit={async (draft) => {
                setBusy(true);
                try {
                  await api.saveOwnSkill({ ...draft, id: skill.id });
                  setEditing(false);
                  onChanged();
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        </Modal>
      ) : null}
    </li>
  );
}
