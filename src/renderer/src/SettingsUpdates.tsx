import { useState } from "react";
import type { AppState, LinkName, UpdateCheck } from "../../shared/types";
import { availableUpdate } from "../../shared/update";
import { api } from "./bridge";
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
  const last = when(settings.lastUpdateCheck);

  return (
    <Section section="updates">
      <p className="faint">
        The app never downloads or installs anything by itself. It can only tell
        you that a newer version exists.
      </p>
      <label className="choice" style={{ alignSelf: "flex-start" }}>
        <input
          type="checkbox"
          checked={settings.checkUpdates}
          onChange={(event) =>
            void save({ checkUpdates: event.target.checked })
          }
        />
        <span>Look for a newer version once a day</span>
      </label>
      <p className="faint">
        Once a day, the app asks GitHub which version is the newest. It sends
        nothing about you. GitHub sees your network address, as any website
        does. It is off until you turn it on.
      </p>
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
        {available ? (
          <span className="wrap">
            <span>Version {available} is available.</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => void run(() => api.openLink("release"))}
            >
              See the release
            </button>
          </span>
        ) : null}
      </div>
      <p className="faint">
        Your version is {version}.{last ? ` Last checked ${last}.` : ""}
      </p>
      <div aria-live="polite">{result ? <OkLine>{result}</OkLine> : null}</div>
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
      <p className="dim">Free to use, change and share. Not to sell.</p>
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
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}
