import { type ReactNode, useEffect, useRef } from "react";
import { SEND_KEYS, TEXT_SIZES } from "../../shared/preferences";
import { THEMES, type Theme } from "../../shared/theme";
import type { AppState, SendKey, TextSize } from "../../shared/types";
import { AccessibilitySection } from "./Accessibility";
import { BackupScreen } from "./Backup";
import { ConnectionsScreen } from "./Connections";
import { DeskPetsScreen } from "./DeskPets";
import { MailScreen } from "./Mail";
import { ModelsScreen } from "./Models";
import { ApprovalsSection, DataSection } from "./SettingsData";
import { MainAssistantSection } from "./SettingsMain";
import { Choices, ErrorLine, Section, useSettingsSave } from "./SettingsParts";
import { ReadingSection } from "./SettingsReading";
import { AboutSection, UpdatesSection } from "./SettingsUpdates";
import {
  escapeLeavesSettings,
  isSettingsPage,
  pageTitle,
  SETTINGS_PAGES,
  type SettingsPageId,
} from "./settings-sections";
import { crossFadeTheme, ScreenHead } from "./ui";

interface SettingsHomeProps {
  state: AppState;
  /** The page that is open. */
  page: SettingsPageId;
  /** Opens another page, from the list or from a button on a page. */
  onPage(page: SettingsPageId, how: "list" | "link"): void;
  onChanged(): Promise<void>;
  /** Back to the chats, by the button or by Escape. */
  onBack(): void;
  /** Every chat was deleted, so the page forgets the ones it loaded. */
  onChatsDeleted(): void;
  /** Opens the list of keyboard shortcuts. */
  onShortcuts(): void;
  /** Opens StellarFirm's site in the browser. */
  onCloud(): void;
}

const THEME_NAMES: Record<Theme, string> = {
  system: "System",
  dark: "Dark",
  light: "Light",
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

/** Whether the key was pressed where Escape belongs to something else. */
function escapeTarget(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  return {
    tag: el?.tagName ?? "",
    type: el instanceof HTMLInputElement ? el.type : undefined,
    contentEditable: el?.isContentEditable === true,
    inDialog:
      Boolean(el?.closest("dialog, [role='alertdialog']")) ||
      Boolean(document.querySelector("dialog[open]")),
  };
}

/**
 * Settings: the one place where the app is set up. Its pages are listed on
 * its own left side (a row of buttons in a narrow window), and the open page
 * scrolls beside the list, which never moves. Escape, or Back to chats, goes
 * back to the chats.
 */
export function SettingsHome(props: SettingsHomeProps) {
  const { page } = props;
  const back = useRef(props.onBack);
  back.current = props.onBack;
  // Heard on the window, so it works wherever the focus is on the page, and
  // after a control that used Escape itself (a search box) has had its turn.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        escapeLeavesSettings({
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.isComposing,
          target: escapeTarget(event.target),
        })
      ) {
        event.preventDefault();
        back.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="settings-home">
      <nav className="settings-nav" aria-label="Settings pages">
        <button type="button" className="btn back-btn" onClick={props.onBack}>
          Back to chats
        </button>
        <ul className="settings-pages">
          {SETTINGS_PAGES.map((p, i) => (
            <li
              key={p.id}
              data-starts={
                i > 0 && p.group !== SETTINGS_PAGES[i - 1]?.group
                  ? "true"
                  : undefined
              }
            >
              <button
                type="button"
                className="nav-item settings-page"
                aria-current={p.id === page ? "page" : undefined}
                onClick={() => props.onPage(p.id, "list")}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <SettingsPage {...props} />
    </div>
  );
}

/** The open page. Each one draws its own frame, so it scrolls on its own. */
function SettingsPage({
  state,
  page,
  onPage,
  onChanged,
  onChatsDeleted,
  onShortcuts,
  onCloud,
}: SettingsHomeProps) {
  switch (page) {
    case "general":
      return (
        <GeneralPage
          state={state}
          onChanged={onChanged}
          onBackup={() => onPage("backup", "link")}
          onChatsDeleted={onChatsDeleted}
        />
      );
    case "models":
      return <ModelsScreen state={state} onChanged={onChanged} />;
    case "connections":
      return (
        <ConnectionsScreen
          state={state}
          onChanged={onChanged}
          onMail={() => onPage("mail", "link")}
        />
      );
    case "mail":
      return <MailScreen state={state} onChanged={onChanged} />;
    case "deskpets":
      return <DeskPetsScreen state={state} />;
    case "accessibility":
      return (
        <PageFrame page="accessibility">
          <AccessibilityPage
            state={state}
            onChanged={onChanged}
            onShortcuts={onShortcuts}
          />
        </PageFrame>
      );
    case "reading":
      return (
        <PageFrame page="reading">
          <ReadingSection />
        </PageFrame>
      );
    case "backup":
      return (
        <BackupScreen onChanged={() => void onChanged()} onCloud={onCloud} />
      );
    case "updates":
      return (
        <PageFrame page="updates">
          <UpdatesSection state={state} onChanged={onChanged} />
          <AboutSection version={state.version} />
        </PageFrame>
      );
  }
}

/** The frame of a page made of sections: the same one every screen has. */
function PageFrame({
  page,
  children,
}: {
  page: SettingsPageId;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title={pageTitle(page)} />
        {children}
      </div>
    </div>
  );
}

function AccessibilityPage({
  state,
  onChanged,
  onShortcuts,
}: {
  state: AppState;
  onChanged(): Promise<void>;
  onShortcuts(): void;
}) {
  const { error, save } = useSettingsSave(onChanged);
  return (
    <>
      <AccessibilitySection
        settings={state.settings}
        save={save}
        onShortcuts={onShortcuts}
      />
      <ErrorLine>{error}</ErrorLine>
    </>
  );
}

/** General: how the app looks and sends, the main assistant, and your data. */
function GeneralPage({
  state,
  onChanged,
  onBackup,
  onChatsDeleted,
}: {
  state: AppState;
  onChanged(): Promise<void>;
  onBackup(): void;
  onChatsDeleted(): void;
}) {
  const { settings } = state;
  const { error, save } = useSettingsSave(onChanged);
  const mac = state.platform === "darwin";

  return (
    <PageFrame page="general">
      <Section section="appearance">
        <Choices
          legend="Theme"
          value={settings.theme}
          options={THEMES.map((id) => ({ id, name: THEME_NAMES[id] }))}
          onPick={(theme) => void crossFadeTheme(theme, () => save({ theme }))}
        />
        <Choices
          legend="Text size"
          value={settings.textSize}
          options={TEXT_SIZES.map((id) => ({ id, name: SIZE_NAMES[id] }))}
          onPick={(textSize) => void save({ textSize })}
        />
      </Section>

      <Section section="chat">
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
              ? "Enter sends, Shift+Enter makes a new line."
              : `${mac ? "Cmd" : "Ctrl"}+Enter sends, Enter makes a new line.`
          }
          onPick={(sendWith) => void save({ sendWith })}
        />
      </Section>

      <MainAssistantSection state={state} onChanged={onChanged} />
      <ApprovalsSection state={state} onChanged={onChanged} />

      <Section section="cloud">
        <label className="choice" style={{ alignSelf: "flex-start" }}>
          <input
            type="checkbox"
            aria-describedby="cloud-card-note"
            checked={!settings.hideCloudCard}
            onChange={(event) =>
              void save({ hideCloudCard: !event.target.checked })
            }
          />
          <span>Show the StellarFirm card in the sidebar</span>
        </label>
        <p className="faint" id="cloud-card-note">
          A link to StellarFirm's paid cloud, and nothing is sent unless you
          click it.
        </p>
      </Section>

      <DataSection
        dataDir={state.dataDir}
        onBackup={onBackup}
        onChatsDeleted={onChatsDeleted}
        onChanged={onChanged}
      />

      <ErrorLine>{error}</ErrorLine>
    </PageFrame>
  );
}

/** The key that opens Settings, as this computer writes it: Cmd or Ctrl and comma. */
export function settingsKeys(mac: boolean): { text: string; aria: string } {
  return mac
    ? { text: "⌘,", aria: "Meta+," }
    : { text: "Ctrl ,", aria: "Control+," };
}

/**
 * Cmd+comma on a Mac, Ctrl+comma elsewhere, opens Settings from anywhere in
 * the app once it is set up, the key most apps keep for it. It waits while a
 * dialog is open, as Find anything does.
 */
export function useSettingsShortcut(
  enabled: boolean,
  mac: boolean,
  open: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const mod = mac ? event.metaKey : event.ctrlKey;
      if (!mod || event.altKey || event.shiftKey || event.repeat) return;
      if (event.key !== "," && event.code !== "Comma") return;
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, mac, open]);
}

const LAST_PAGE_KEY = "openstellarfirm.settings-page";

/** The page Settings was left on, kept on this computer only. */
export function lastSettingsPage(): SettingsPageId | null {
  try {
    const kept = localStorage.getItem(LAST_PAGE_KEY);
    return isSettingsPage(kept) ? kept : null;
  } catch {
    return null;
  }
}

export function keepSettingsPage(page: SettingsPageId): void {
  try {
    localStorage.setItem(LAST_PAGE_KEY, page);
  } catch {
    // Nothing is lost but the place: Settings opens on its first page.
  }
}
