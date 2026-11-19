import { useEffect, useId, useRef, useState } from "react";
import type { OcrLanguage } from "../../shared/types";
import { fileSize } from "./Attachments";
import { refocusIfLost } from "./a11y";
import { api } from "./bridge";
import { ErrorLine, Section, useAction } from "./SettingsParts";
import { OkLine } from "./ui";

/**
 * Reading other languages. The reader on this computer reads text from
 * pictures and scanned PDFs in English. Another language is one download, on
 * the person's click, from one pinned address, checked before it is kept.
 */
export function ReadingSection() {
  const [languages, setLanguages] = useState<OcrLanguage[]>([]);
  const [chosen, setChosen] = useState("");
  const [done, setDone] = useState("");
  const { busy, error, run } = useAction();
  const selectId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    api
      .ocrLanguages()
      .then(setLanguages)
      .catch(() => setLanguages([]));
  }, []);

  const installed = languages.filter((l) => l.installed);
  const available = languages.filter((l) => !l.installed);
  const pick = available.find((l) => l.code === chosen) ?? available[0];

  return (
    <Section section="reading">
      <p className="faint">
        When a model cannot read a picture or a scanned PDF, the app reads its
        text on this computer and sends that instead. It reads English. To read
        another language, download it here. That download is the only thing this
        does on the internet: one file from huggingface.co, checked against the
        copy the app expects before it is kept.
      </p>
      <p>Reads: {installed.map((l) => l.name).join(", ") || "English"}</p>
      {installed.some((l) => !l.builtIn) ? (
        <ul className="plain stack-tight" aria-label="Downloaded languages">
          {installed
            .filter((l) => !l.builtIn)
            .map((l) => (
              <li key={l.code} className="wrap">
                <span>{l.name}</span>
                <button
                  type="button"
                  className="btn"
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (busy) return;
                    void run(async () => {
                      setDone("");
                      setLanguages(await api.removeOcrLanguage(l.code));
                      setDone(`Removed ${l.name}.`);
                      // The row went with its button; the list to add from is next.
                      refocusIfLost(() => selectRef.current);
                    });
                  }}
                >
                  Remove {l.name}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
      {pick ? (
        <div className="wrap">
          <label className="visually-hidden" htmlFor={selectId}>
            Language to download
          </label>
          <select
            ref={selectRef}
            id={selectId}
            className="input"
            style={{ width: "auto" }}
            value={pick.code}
            disabled={busy}
            onChange={(event) => setChosen(event.target.value)}
          >
            {available.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name} ({fileSize(l.size)})
              </option>
            ))}
          </select>
          {/* Not disabled while it downloads, so the focus stays on it. */}
          <button
            type="button"
            className="btn"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              void run(async () => {
                setDone("");
                setLanguages(await api.downloadOcrLanguage(pick.code));
                setChosen("");
                setDone(`Downloaded and checked ${pick.name}.`);
              });
            }}
          >
            {busy
              ? `Downloading ${pick.name}…`
              : `Download ${pick.name} (${fileSize(pick.size)})`}
          </button>
        </div>
      ) : null}
      <div aria-live="polite">
        {done ? <OkLine parentAnnounces>{done}</OkLine> : null}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}
