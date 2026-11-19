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

const EXAMPLE =
  "For example: new mail that needs an answer today, and anything in my Notes folder marked urgent.";

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
    <Section title="Main assistant">
      <p className="faint">
        Pick one assistant to check on things for you. It only works while this
        app is open. Each check uses your model, which costs you money if the
        model is a paid service. A check only reads: anything that would need
        your Approve is left for you, and it says so in its update.
      </p>

      <label className="field">
        <span className="field-label">Main assistant</span>
        <select
          className="input"
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

      {main ? (
        <>
          <label className="field">
            <span className="field-label">What to look for</span>
            <span className="faint" id={`${id}-hint`}>
              {EXAMPLE}
            </span>
            <textarea
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
            note="At most 48 checks a day. A check waits while the assistant is answering or a step waits for you."
            onPick={(next) =>
              void save({ checkEvery: Number(next) as CheckEvery })
            }
          />

          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              checked={check.notify}
              onChange={(event) =>
                void save({ checkNotify: event.target.checked })
              }
            />
            <span>Tell me with a notification</span>
          </label>
          <p className="faint">
            The notice says only that {main.name} has an update. Never what it
            says. Without it, a small mark shows in the sidebar.
          </p>

          <div className="wrap">
            <button
              type="button"
              className="btn"
              disabled={busy || !lookFor.trim()}
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
            {started ? <OkLine>{started}</OkLine> : null}
          </div>
        </>
      ) : null}
      <ErrorLine>{error || saveError}</ErrorLine>
    </Section>
  );
}
