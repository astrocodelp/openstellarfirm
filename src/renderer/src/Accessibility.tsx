import { useEffect, useId, useRef } from "react";
import {
  type AccessibilityPrefs,
  CONTRASTS,
  type Contrast,
  cleanAccessibility,
  MOTIONS,
  type Motion,
  READ_RATES,
  type ReadRate,
  shortcuts,
} from "../../shared/accessibility";
import type { SendKey, Settings } from "../../shared/types";
import {
  speak,
  speakingNow,
  stopSpeaking,
  useModalDialog,
  useSpeech,
} from "./a11y";
import { Choices, Section } from "./SettingsParts";
import { Icon } from "./ui";

/** Accessibility: the Settings section, the shortcuts list, the skip links and read aloud. */

const CONTRAST_NAMES: Record<Contrast, string> = {
  system: "Follow this computer",
  more: "More contrast",
  standard: "Standard",
};

const MOTION_NAMES: Record<Motion, string> = {
  system: "Follow this computer",
  reduce: "Less motion",
  full: "Full motion",
};

const RATE_NAMES: Record<ReadRate, string> = {
  0.8: "Slower",
  1: "Normal",
  1.25: "Faster",
  1.5: "Fastest",
};

const FLAGS: {
  key: "underlineLinks" | "strongFocus" | "readingSpace" | "largeTargets";
  name: string;
  /** Only where the name does not say it all. */
  note?: string;
}[] = [
  {
    key: "underlineLinks",
    name: "Underline links",
    note: "Buttons that open your browser are underlined too.",
  },
  {
    key: "strongFocus",
    name: "A stronger focus ring",
  },
  {
    key: "readingSpace",
    name: "More space for reading",
    note: "Between lines, letters and words.",
  },
  {
    key: "largeTargets",
    name: "Larger click targets",
  },
];

/** The text read by "Try it", at the chosen speed. */
const SAMPLE = "This is how an answer is read aloud.";

export function AccessibilitySection({
  settings,
  save,
  onShortcuts,
}: {
  settings: Settings;
  save(patch: Partial<Settings>): Promise<void>;
  onShortcuts(): void;
}) {
  const prefs = cleanAccessibility(settings.accessibility);
  const speech = useSpeech();
  // Two choices made before the first is saved build on each other, so the
  // second never puts back what the first changed.
  const pending = useRef<AccessibilityPrefs | null>(null);
  const change = (patch: Partial<AccessibilityPrefs>) => {
    const next = { ...(pending.current ?? prefs), ...patch };
    pending.current = next;
    void save({ accessibility: next }).finally(() => {
      if (pending.current === next) pending.current = null;
    });
  };

  return (
    <Section section="accessibility">
      <p className="faint">Everything here is saved on this computer only.</p>
      <Choices
        legend="Contrast"
        value={prefs.contrast}
        options={CONTRASTS.map((id) => ({ id, name: CONTRAST_NAMES[id] }))}
        onPick={(contrast) => change({ contrast })}
      />
      <Choices
        legend="Motion"
        value={prefs.motion}
        options={MOTIONS.map((id) => ({ id, name: MOTION_NAMES[id] }))}
        note="Less motion keeps short fades and stops everything that moves or breathes."
        onPick={(motion) => change({ motion })}
      />
      <fieldset className="plain stack">
        <legend className="field-label">Easier to see and to use</legend>
        {FLAGS.map((flag) => (
          <Flag
            key={flag.key}
            name={flag.name}
            note={flag.note}
            checked={prefs[flag.key]}
            onChange={(on) => change({ [flag.key]: on })}
          />
        ))}
      </fieldset>

      {speech.available === "no" ? (
        // No speed or sample to offer when no voice can read: one plain line.
        <p className="faint">
          Read aloud is not available on this computer: it has no voice that
          works without the internet.
        </p>
      ) : (
        <Choices
          legend="Read aloud speed"
          value={`${prefs.readRate}`}
          options={READ_RATES.map((rate) => ({
            id: `${rate}`,
            name: RATE_NAMES[rate],
          }))}
          note="It uses a voice on this computer, so no text leaves it."
          onPick={(rate) => change({ readRate: Number(rate) as ReadRate })}
        />
      )}
      <div className="wrap">
        {speech.available === "no" ? null : (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (speech.speaking === "sample") stopSpeaking();
              else speak("sample", SAMPLE, prefs.readRate);
            }}
          >
            <Icon name={speech.speaking === "sample" ? "stop" : "speaker"} />
            {speech.speaking === "sample" ? "Stop" : "Try read aloud"}
          </button>
        )}
        <button type="button" className="btn" onClick={onShortcuts}>
          Keyboard shortcuts
        </button>
      </div>
      <details className="how">
        <summary>How these settings work</summary>
        <p className="faint">
          Contrast and motion follow your computer's own settings until you
          change them here. More contrast makes text, edges and lines stronger,
          in light and dark. Underline links underlines every link, and every
          button that opens a page in your browser. A stronger focus ring is a
          thicker ring around the control you reach with the keyboard. Larger
          click targets makes buttons, rows and boxes bigger and easier to hit.
          Each answer has a Read aloud button. It uses a voice on this computer
          only, so no text leaves it. Everything here is saved on this computer
          only.
        </p>
      </details>
    </Section>
  );
}

function Flag({
  name,
  note,
  checked,
  onChange,
}: {
  name: string;
  note?: string;
  checked: boolean;
  onChange(on: boolean): void;
}) {
  const id = useId();
  return (
    <div className="stack-tight">
      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={note ? id : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{name}</span>
      </label>
      {note ? (
        <p className="faint" id={id}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

/** The keys of the app, opened with Ctrl or Cmd and "/". */
export function ShortcutsDialog({
  open,
  mac,
  sendWith,
  onClose,
}: {
  open: boolean;
  mac: boolean;
  sendWith: SendKey;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useModalDialog(ref, open);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog; the click is only the backdrop
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Only a click on the dimmed page around it, not on its own padding.
        const box = ref.current;
        if (event.target !== box || !box) return;
        const r = box.getBoundingClientRect();
        const inside =
          event.clientX >= r.left &&
          event.clientX <= r.right &&
          event.clientY >= r.top &&
          event.clientY <= r.bottom;
        if (!inside) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 className="section-title" id={titleId}>
          Keyboard shortcuts
        </h2>
        {/* The first control, so the focus lands on it when the list opens. */}
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {shortcuts(mac, sendWith).map((group) => (
        <section key={group.group} className="stack-tight">
          <h3 className="field-label">{group.group}</h3>
          <dl className="keys">
            {group.items.map((item) => (
              <div key={item.does} className="keys-row">
                <dt>
                  {item.keys.map((key, index) => (
                    <span key={key}>
                      {index > 0 ? <span className="faint"> + </span> : null}
                      <kbd>{key}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{item.does}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </dialog>
  );
}

/**
 * Opens the shortcuts list on Ctrl or Cmd with "/", from anywhere in the app
 * once it is set up. Like Find anything, it waits while another dialog is
 * open, so the two never stack.
 */
export function useShortcutsKey(enabled: boolean, open: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.altKey) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== "/" && event.code !== "Slash") return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open]);
}

/**
 * The first things Tab reaches: a way past the sidebar, straight to the
 * message box or to the screen. Hidden until they have the focus.
 */
export function SkipLinks({ messageBox }: { messageBox: boolean }) {
  const go = (id: string) => {
    const target = document.getElementById(id);
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  };
  // Buttons, not links: they move the focus and change no address.
  return (
    <div className="skip-links">
      {messageBox ? (
        <button
          type="button"
          className="skip-link"
          onClick={() => go("message-box")}
        >
          Skip to the message box
        </button>
      ) : null}
      <button type="button" className="skip-link" onClick={() => go("main")}>
        Skip to the main content
      </button>
    </div>
  );
}

/**
 * The button under an answer that reads it with a voice on this computer.
 * When the computer has no such voice, it says so instead of reading.
 */
export function ReadAloud({
  id,
  text,
  rate,
}: {
  id: string;
  text: string;
  rate: number;
}) {
  const speech = useSpeech();
  const reading = speech.speaking === id;
  // Reading stops when the answer leaves the page, and only if it is still this one.
  useEffect(
    () => () => {
      if (speakingNow() === id) stopSpeaking();
    },
    [id],
  );
  // Nothing while voices are looked for, and nothing without a local voice:
  // Settings, Accessibility says why. So no answer changes size later.
  if (speech.available !== "yes") return null;
  return (
    <button
      type="button"
      className="read-aloud"
      onClick={() => (reading ? stopSpeaking() : speak(id, text, rate))}
    >
      <Icon name={reading ? "stop" : "speaker"} size={14} />
      {reading ? "Stop reading" : "Read aloud"}
    </button>
  );
}
