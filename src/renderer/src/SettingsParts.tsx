import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Settings } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText } from "./ui";

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

/** One section of the screen, with a heading a screen reader can jump to. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-section stack" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A few native radio buttons that choose one value. */
export function Choices<T extends string>({
  legend,
  value,
  options,
  note,
  onPick,
}: {
  legend: string;
  value: T;
  options: readonly { id: T; name: string }[];
  note?: string;
  onPick(next: T): void;
}) {
  const ids = useId();
  return (
    <fieldset className="plain stack">
      <legend className="field-label">{legend}</legend>
      <div className="wrap" role="radiogroup" aria-describedby={`${ids}-note`}>
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
 * button, and Escape closes it.
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
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div
      className="confirm stack"
      role="alertdialog"
      aria-label={doLabel}
      onKeyDown={(event) => {
        if (event.key === "Escape") onKeep();
      }}
    >
      <p>{text}</p>
      <div className="wrap">
        <button ref={keep} type="button" className="btn" onClick={onKeep}>
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
