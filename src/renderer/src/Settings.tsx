import { SEND_KEYS, TEXT_SIZES } from "../../shared/preferences";
import { THEMES, type Theme } from "../../shared/theme";
import type { AppState, SendKey, TextSize } from "../../shared/types";
import { ApprovalsSection, DataSection } from "./SettingsData";
import { Choices, ErrorLine, Section, useSettingsSave } from "./SettingsParts";
import { AboutSection, UpdatesSection } from "./SettingsUpdates";
import { ScreenHead } from "./ui";

interface SettingsScreenProps {
  state: AppState;
  onChanged(): Promise<void>;
  onBack(): void;
  /** Opens the Move or back up screen. */
  onBackup(): void;
  /** Every chat was deleted, so the page forgets the ones it loaded. */
  onChatsDeleted(): void;
}

const THEME_CHOICES: Record<Theme, { name: string; note: string }> = {
  system: { name: "System", note: "Follow this computer's setting." },
  dark: { name: "Dark", note: "Night background, ivory text." },
  light: { name: "Light", note: "Ivory background, night text." },
};

const SIZE_NAMES: Record<TextSize, string> = {
  small: "Small",
  default: "Default",
  large: "Large",
};

const SEND_NAMES: Record<SendKey, string> = {
  enter: "Enter",
  "mod-enter": "Ctrl or Cmd with Enter",
};

/** Settings is a screen of sections. Each section is its own block. */
export function SettingsScreen({
  state,
  onChanged,
  onBack,
  onBackup,
  onChatsDeleted,
}: SettingsScreenProps) {
  const { settings } = state;
  const { error, save } = useSettingsSave(onChanged);
  const mac = state.platform === "darwin";

  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title="Settings" onBack={onBack} />

        <Section title="Appearance">
          <Choices
            legend="Theme"
            value={settings.theme}
            options={THEMES.map((id) => ({
              id,
              name: THEME_CHOICES[id].name,
            }))}
            note={THEME_CHOICES[settings.theme].note}
            onPick={(theme) => void save({ theme })}
          />
          <Choices
            legend="Text size"
            value={settings.textSize}
            options={TEXT_SIZES.map((id) => ({ id, name: SIZE_NAMES[id] }))}
            note="Makes everything in the app bigger or smaller."
            onPick={(textSize) => void save({ textSize })}
          />
        </Section>

        <Section title="Chat">
          <Choices
            legend="Send with"
            value={settings.sendWith}
            options={SEND_KEYS.map((id) => ({
              id,
              name:
                id === "mod-enter"
                  ? `${mac ? "Cmd" : "Ctrl"}+Enter`
                  : SEND_NAMES[id],
            }))}
            note={
              settings.sendWith === "enter"
                ? "Enter sends. Shift+Enter makes a new line."
                : `${mac ? "Cmd" : "Ctrl"}+Enter sends. Enter makes a new line.`
            }
            onPick={(sendWith) => void save({ sendWith })}
          />
        </Section>

        <Section title="StellarFirm cloud">
          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              checked={!settings.hideCloudCard}
              onChange={(event) =>
                void save({ hideCloudCard: !event.target.checked })
              }
            />
            <span>Show the StellarFirm card in the sidebar</span>
          </label>
          <p className="faint">
            The card is a link to StellarFirm, the paid cloud service. Nothing
            is sent anywhere unless you click it.
          </p>
        </Section>

        <ApprovalsSection state={state} onChanged={onChanged} />
        <DataSection
          dataDir={state.dataDir}
          onBackup={onBackup}
          onChatsDeleted={onChatsDeleted}
          onChanged={onChanged}
        />
        <UpdatesSection state={state} onChanged={onChanged} />
        <AboutSection version={state.version} />

        <ErrorLine>{error}</ErrorLine>
      </div>
    </div>
  );
}
