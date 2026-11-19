import { useEffect, useId, useState } from "react";
import {
  CHECK_EVERY,
  type CheckEvery,
  checkSettings,
  EVERY_NAMES,
  LOOK_FOR_MAX,
} from "../../shared/checks";
import type { AppState } from "../../shared/types";
import { api } from "./bridge";
import {
  Choices,
  ErrorLine,
  Section,
  useAction,
  useSettingsSave,
} from "./SettingsParts";
import { OkLine } from "./ui";

const EXAMPLE = "For example: new mail that needs an answer today.";

/**
 * Settings, Main assistant: one assistant that checks on its own while the app
 * is open. A check only reads, and anything that needs your Approve is left
 * for you.
 */
export function MainAssistantSection({
  state,
  onChanged,
}: {
  state: AppState;
  onChanged(): Promise<void>;
}) {
  const check = checkSettings(state.settings);
  const { error: saveError, save } = useSettingsSave(onChanged);
  const { busy, error, run } = useAction();
  const [started, setStarted] = useState("");
  const [lookFor, setLookFor] = useState(check.lookFor);
  const id = useId();
  const main = state.assistants.find((a) => a.id === check.mainAssistantId);

  // Follows the saved text when it changes from somewhere else.
  useEffect(() => setLookFor(check.lookFor), [check.lookFor]);

  return (
    <Section section="main">
      <label className="field">
        <span className="field-label" id={`${id}-main`}>
          Main assistant
        </span>
        <span className="faint" id={`${id}-main-note`}>
          A check only reads, and it uses your model, which may cost money.
        </span>
        <select
          className="input"
          aria-labelledby={`${id}-main`}
          aria-describedby={`${id}-main-note`}
          value={check.mainAssistantId ?? ""}
          onChange={(event) =>
            void save({ mainAssistantId: event.target.value })
          }
        >
          <option value="">None</option>
          {state.assistants.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <details className="how">
        <summary>How checks work</summary>
        <p className="faint">
          Pick one assistant to check on things for you. It only works while
          this app is open. Each check uses your model, which costs you money if
          the model is a paid service. A check only reads: anything that would
          need your Approve is left for you, and it says so in its update. At
          most 48 checks a day. A check waits while the assistant is answering
          or a step waits for you. A notification says only that the assistant
          has an update, never what it says. Without one, a small mark shows in
          the sidebar.
        </p>
      </details>

      {main ? (
        <>
          <label className="field">
            <span className="field-label" id={`${id}-label`}>
              What to look for
            </span>
            <span className="faint" id={`${id}-hint`}>
              {EXAMPLE}
            </span>
            <textarea
              aria-labelledby={`${id}-label`}
              className="input"
              rows={4}
              value={lookFor}
              maxLength={LOOK_FOR_MAX}
              aria-describedby={`${id}-hint`}
              onChange={(event) => setLookFor(event.target.value)}
              onBlur={() => {
                if (lookFor !== check.lookFor)
                  void save({ checkLookFor: lookFor });
              }}
            />
          </label>

          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              checked={check.on}
              onChange={(event) =>
                void save({ checkOnItsOwn: event.target.checked })
              }
            />
            <span>Check on its own</span>
          </label>

          <Choices<`${CheckEvery}`>
            legend="How often"
            value={`${check.every}`}
            options={CHECK_EVERY.map((minutes) => ({
              id: `${minutes}` as const,
              name: EVERY_NAMES[minutes],
            }))}
            onPick={(next) =>
              void save({ checkEvery: Number(next) as CheckEvery })
            }
          />

          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              aria-describedby={`${id}-notify-note`}
              checked={check.notify}
              onChange={(event) =>
                void save({ checkNotify: event.target.checked })
              }
            />
            <span>Tell me with a notification</span>
          </label>
          <p className="faint" id={`${id}-notify-note`}>
            The notice says only that {main.name} has an update, never what.
          </p>

          <div className="wrap">
            <button
              type="button"
              className="btn"
              disabled={busy || !lookFor.trim()}
              aria-label={`Check now with ${main.name}`}
              onClick={() =>
                void run(async () => {
                  setStarted("");
                  if (lookFor !== check.lookFor)
                    await api.setSettings({ checkLookFor: lookFor });
                  await api.checkNow();
                  setStarted(
                    `Checking now. The update will appear in ${main.name}'s chat.`,
                  );
                  await onChanged();
                })
              }
            >
              Check now
            </button>
          </div>
          <div aria-live="polite">
            {started ? <OkLine parentAnnounces>{started}</OkLine> : null}
          </div>
        </>
      ) : null}
      <ErrorLine>{error || saveError}</ErrorLine>
    </Section>
  );
}
