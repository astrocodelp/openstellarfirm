import { type ReactNode, useId, useState } from "react";
import type { Settings } from "../../shared/types";
import { api } from "./bridge";
import { type SettingsSectionId, sectionTitle } from "./settings-sections";
import { ErrorLine, message as errorText, useInlineConfirm } from "./ui";

/** Pieces the settings sections share. */

/** Saves a change to the settings, then asks the app to read them again. */
export function useSettingsSave(onChanged: () => Promise<void>) {
  const [error, setError] = useState("");
  async function save(patch: Partial<Settings>) {
    setError("");
    try {
      await api.setSettings(patch);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return { error, save };
}

/**
 * One section of the screen, with a heading a screen reader can jump to. Its
 * heading comes from the one list Find anything also reads.
 */
export function Section({
  section,
  children,
}: {
  section: SettingsSectionId;
  children: ReactNode;
}) {
  const id = useId();
  const title = sectionTitle(section);
  return (
    <section className="settings-section stack" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A few native radio buttons that choose one value, drawn as pills. One tab
 * stop, and the arrow keys move the choice, as a screen reader expects.
 */
export function Choices<T extends string>({
  legend,
  legendHidden,
  value,
  options,
  note,
  onPick,
}: {
  legend: string;
  /** For a filter whose heading is already on the page. */
  legendHidden?: boolean;
  value: T;
  options: readonly { id: T; name: ReactNode }[];
  note?: string;
  onPick(next: T): void;
}) {
  const ids = useId();
  return (
    <fieldset className="plain stack">
      <legend
        className={legendHidden ? "visually-hidden" : "field-label"}
        id={`${ids}-legend`}
      >
        {legend}
      </legend>
      <div
        className="wrap"
        role="radiogroup"
        aria-labelledby={`${ids}-legend`}
        aria-describedby={note ? `${ids}-note` : undefined}
      >
        {options.map((option) => (
          <label key={option.id} className="choice">
            <input
              type="radio"
              name={ids}
              value={option.id}
              checked={value === option.id}
              onChange={() => onPick(option.id)}
            />
            <span>{option.name}</span>
          </label>
        ))}
      </div>
      {note ? (
        <p className="faint" id={`${ids}-note`}>
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * The question before something that cannot be undone. Focus lands on the safe
 * button, Escape closes it, and focus goes back to the button that opened it.
 */
export function Confirm({
  text,
  doLabel,
  keepLabel,
  busy,
  onDo,
  onKeep,
}: {
  text: string;
  doLabel: string;
  keepLabel: string;
  busy: boolean;
  onDo(): void;
  onKeep(): void;
}) {
  const confirm = useInlineConfirm<HTMLDivElement>(onKeep);
  return (
    <div
      ref={confirm.ref}
      className="confirm stack"
      role="alertdialog"
      aria-label={doLabel}
      onKeyDown={confirm.onKeyDown}
    >
      <p>{text}</p>
      <div className="wrap">
        <button data-autofocus type="button" className="btn" onClick={onKeep}>
          {keepLabel}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy}
          onClick={onDo}
        >
          {doLabel}
        </button>
      </div>
    </div>
  );
}

/** Runs a click, keeping the busy and error state in one place. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export { ErrorLine };

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
