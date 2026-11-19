import { useState } from "react";
import type { BackupResult } from "../../shared/types";
import { api } from "./bridge";
import { pageTitle } from "./settings-sections";
import {
  ErrorLine,
  message as errorText,
  Icon,
  OkLine,
  ScreenHead,
} from "./ui";

interface BackupProps {
  /** Assistants were added, so the app should read its state again. */
  onChanged(): void;
  onCloud(): void;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function resultLine(r: BackupResult): string {
  const parts = [`${plural(r.added, "assistant", "assistants")} added`];
  if (r.chats > 0) parts.push(`${plural(r.chats, "chat", "chats")} brought in`);
  if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
  return `${parts.join(", ")}.`;
}

/** Move every assistant to another computer, or keep a copy. */
export function BackupScreen({ onChanged, onCloud }: BackupProps) {
  const [includeChats, setIncludeChats] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<BackupResult | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNote("");
    setResult(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-body">
        <ScreenHead title={pageTitle("backup")}>
          Save your assistants to a file, then open it in the app on another
          computer.
        </ScreenHead>

        <section
          className="stack settings-section"
          aria-labelledby="export-title"
        >
          <h2 className="section-title" id="export-title">
            Export everything
          </h2>
          <p className="faint">
            Your keys, models, folders, sites and settings are never in the
            file.
          </p>
          <label className="choice" style={{ alignSelf: "flex-start" }}>
            <input
              type="checkbox"
              aria-describedby="backup-chats-note"
              checked={includeChats}
              onChange={(event) => setIncludeChats(event.target.checked)}
            />
            <span>Include my chats</span>
          </label>
          <p className="faint" id="backup-chats-note">
            The file is not encrypted, so keep it somewhere you trust.
          </p>
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (await api.exportBackup(includeChats))
                    setNote("Saved. Move that file to your other computer.");
                })
              }
            >
              <Icon name="download" />
              Export everything
            </button>
          </div>
          <details className="how">
            <summary>What a backup holds</summary>
            <p className="faint">
              Each assistant's name, look, brief and skills, in one file. Your
              keys, models, folders, sites and settings are never in it. Chats
              can hold private text, and the file is not encrypted. Files you
              attached to messages are not in it either: they stay on this
              computer, and a chat in the backup names them but does not hold
              them.
            </p>
          </details>
        </section>

        <section
          className="stack settings-section"
          aria-labelledby="import-title"
        >
          <h2 className="section-title" id="import-title">
            Import a backup
          </h2>
          <p className="faint">
            Adds them as new assistants and changes nothing you already have.
          </p>
          <div>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const done = await api.importBackup();
                  if (!done) return;
                  setResult(done);
                  onChanged();
                })
              }
            >
              <Icon name="upload" />
              Import a backup
            </button>
          </div>
          <details className="how">
            <summary>How an import works</summary>
            <p className="faint">
              Adds the assistants in a backup file as new ones. Nothing you
              already have is changed or removed. Each one starts with no
              folders, no sites, web pages off and no model of its own, so you
              choose those again.
            </p>
          </details>
        </section>

        <div className="stack" aria-live="polite">
          {note ? <OkLine parentAnnounces>{note}</OkLine> : null}
          {result ? (
            <>
              <OkLine parentAnnounces>{resultLine(result)}</OkLine>
              {result.full ? (
                <p className="faint">
                  The app holds a limited number of assistants, so the rest did
                  not fit.
                </p>
              ) : null}
            </>
          ) : null}
          <ErrorLine>{error}</ErrorLine>
        </div>

        <p className="faint">
          Want your assistants to keep working when this computer is off?{" "}
          <button type="button" className="link-btn" onClick={onCloud}>
            Use StellarFirm cloud instead
          </button>
        </p>
      </div>
    </div>
  );
}
