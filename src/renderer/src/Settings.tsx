import { useId, useState } from "react";
import { THEMES, type Theme } from "../../shared/theme";
import type { AppState } from "../../shared/types";
import { api } from "./bridge";
import { ErrorLine, message as errorText } from "./ui";

interface SettingsScreenProps {
  state: AppState;
  onChanged(): Promise<void>;
  onBack(): void;
}

const THEME_CHOICES: Record<Theme, { name: string; note: string }> = {
  system: { name: "System", note: "Follow this computer's setting." },
  dark: { name: "Dark", note: "Night background, ivory text." },
  light: { name: "Light", note: "Ivory background, night text." },
};

/** Settings is a screen of sections. Each section is its own block below. */
export function SettingsScreen({
  state,
  onChanged,
  onBack,
}: SettingsScreenProps) {
  return (
    <div className="screen">
      <div className="screen-body">
        <div className="stack-tight">
          <div>
            <button type="button" className="btn" onClick={onBack}>
              Back to chats
            </button>
          </div>
          <h1 className="screen-title">Settings</h1>
        </div>
        <AppearanceSection theme={state.settings.theme} onChanged={onChanged} />
      </div>
    </div>
  );
}

function AppearanceSection({
  theme,
  onChanged,
}: {
  theme: Theme;
  onChanged(): Promise<void>;
}) {
  const ids = useId();
  const [error, setError] = useState("");

  async function pick(next: Theme) {
    setError("");
    try {
      await api.setSettings({ theme: next });
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="stack" aria-labelledby={`${ids}-title`}>
      <h2 className="section-title" id={`${ids}-title`}>
        Appearance
      </h2>
      <fieldset className="plain stack">
        <legend className="field-label">Theme</legend>
        <div
          className="wrap"
          role="radiogroup"
          aria-describedby={`${ids}-note`}
        >
          {THEMES.map((id) => (
            <label key={id} className="choice">
              <input
                type="radio"
                name={`${ids}-theme`}
                value={id}
                checked={theme === id}
                onChange={() => void pick(id)}
              />
              <span>{THEME_CHOICES[id].name}</span>
            </label>
          ))}
        </div>
        <p className="faint" id={`${ids}-note`}>
          {THEME_CHOICES[theme].note}
        </p>
      </fieldset>
      <ErrorLine>{error}</ErrorLine>
    </section>
  );
}
