import { useState } from "react";
import { downloadFile } from "../../shared/links";
import type { AppState, LinkName, UpdateCheck } from "../../shared/types";
import { availableUpdate } from "../../shared/update";
import { api } from "./bridge";
import { LicencesButton } from "./Licences";
import {
  ErrorLine,
  Section,
  useAction,
  useSettingsSave,
} from "./SettingsParts";
import { Icon, OkLine } from "./ui";

function when(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function verdict(found: UpdateCheck): string {
  if (found.status === "newer") return `Version ${found.version} is available.`;
  if (found.status === "current") return "You have the newest version.";
  return "Could not check right now. Try again later.";
}

export function UpdatesSection({
  state,
  onChanged,
}: {
  state: AppState;
  onChanged(): Promise<void>;
}) {
  const { settings, version } = state;
  const { error: saveError, save } = useSettingsSave(onChanged);
  const { busy, error, run } = useAction();
  const [result, setResult] = useState("");
  const available = availableUpdate(settings, version);
  const file = available
    ? downloadFile(available, { platform: state.platform, arch: state.arch })
    : null;
  const last = when(settings.lastUpdateCheck);

  return (
    <Section section="updates">
      <p className="faint">
        The app only tells you a newer version exists, and never installs one by
        itself.
      </p>
      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          aria-describedby="update-check-note"
          checked={settings.checkUpdates}
          onChange={(event) =>
            void save({ checkUpdates: event.target.checked })
          }
        />
        <span>Look for new versions at launch and once a day</span>
      </label>
      <p className="faint" id="update-check-note">
        It asks GitHub and sends nothing about you.
      </p>
      {settings.checkUpdates ? (
        <label className="choice" style={{ alignSelf: "flex-start" }}>
          <input
            type="checkbox"
            checked={settings.updateNotify !== false}
            onChange={(event) =>
              void save({ updateNotify: event.target.checked })
            }
          />
          <span>Show a notice when a new version is out</span>
        </label>
      ) : null}
      {available ? (
        <div className="stack-tight">
          <p>Version {available} is available.</p>
          <div className="wrap">
            {file ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void run(() => api.openLink("download"))}
              >
                Download {available}
                <Icon name="external" size={14} />
              </button>
            ) : null}
            <button
              type="button"
              className={file ? "link-btn" : "btn"}
              onClick={() => void run(() => api.openLink("release"))}
            >
              See what's new
            </button>
          </div>
          <p className="faint">
            {file
              ? "Install it as you did the first time, and your computer may warn you again."
              : "Pick the file for your computer on the release page, and install it as you did the first time."}
          </p>
        </div>
      ) : null}
      <div className="wrap">
        <button
          type="button"
          className="btn"
          disabled={busy}
          // Two "Check now" buttons share this screen; the name tells them apart.
          aria-label="Check now for a newer version"
          onClick={() =>
            void run(async () => {
              setResult(verdict(await api.checkForUpdate()));
              await onChanged();
            })
          }
        >
          Check now
        </button>
      </div>
      <p className="faint">
        Your version is {version}.{last ? ` Last checked ${last}.` : ""}
      </p>
      <details className="how">
        <summary>How the update check works</summary>
        <p className="faint">
          The app never downloads or installs anything by itself. It can only
          tell you that a newer version exists. While the switch is on, the app
          asks GitHub which version is the newest each time it starts (at most
          once every ten minutes) and once a day while it stays open. It sends
          nothing about you. GitHub sees your network address, as any website
          does. It is off until you turn it on, and Check now works either way.
        </p>
        <p className="faint">
          When a check finds a new version, the app shows one notice for it,
          once. Download opens this computer&apos;s file on GitHub in your
          browser, and you install it yourself, as you did the first time.
        </p>
      </details>
      <div aria-live="polite">
        {result ? <OkLine parentAnnounces>{result}</OkLine> : null}
      </div>
      <ErrorLine>{error || saveError}</ErrorLine>
    </Section>
  );
}

const ABOUT_LINKS: { name: LinkName; label: string }[] = [
  { name: "source", label: "Source code" },
  { name: "community", label: "Community" },
];

export function AboutSection({ version }: { version: string }) {
  const { error, run } = useAction();
  return (
    <Section section="about">
      <p>OpenStellarFirm, version {version}</p>
      <p className="dim">Free to use, change and share, not to sell.</p>
      <p className="faint">Apache License 2.0 with the Commons Clause.</p>
      <div className="wrap">
        {ABOUT_LINKS.map((link) => (
          <button
            key={link.name}
            type="button"
            className="btn"
            onClick={() => void run(() => api.openLink(link.name))}
          >
            {link.label}
            <Icon name="external" size={14} />
          </button>
        ))}
        <LicencesButton />
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}
