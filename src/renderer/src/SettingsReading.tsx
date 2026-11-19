import { useEffect, useId, useRef, useState } from "react";
import { cleanProgress, progressPercent } from "../../shared/download-progress";
import type { OcrLanguage } from "../../shared/types";
import { fileSize } from "./Attachments";
import { announce, refocusIfLost } from "./a11y";
import { api } from "./bridge";
import { ErrorLine, Section, useAction } from "./SettingsParts";
import { OkLine } from "./ui";

/** What the last download or removal came to, said once. */
type Outcome = { ok: boolean; text: string } | null;

/**
 * Reading other languages. The reader on this computer reads text from
 * pictures and scanned PDFs in English. Another language is one download, on
 * the person's click, from one pinned address, checked before it is kept.
 */
export function ReadingSection() {
  const [languages, setLanguages] = useState<OcrLanguage[]>([]);
  const [chosen, setChosen] = useState("");
  const [done, setDone] = useState<Outcome>(null);
  /** The language downloading now, and how many of its bytes are in. */
  const [downloading, setDownloading] = useState<OcrLanguage | null>(null);
  const [received, setReceived] = useState(0);
  const [stopping, setStopping] = useState(false);
  const { busy, error, run } = useAction();
  const selectId = useId();
  const barId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const stopRef = useRef<HTMLButtonElement>(null);
  /** Read by the progress listener, which is set up once. */
  const current = useRef("");
  const stopAsked = useRef(false);

  useEffect(() => {
    api
      .ocrLanguages()
      .then(setLanguages)
      .catch(() => setLanguages([]));
  }, []);

  // Progress for any other code, or in any other shape, is ignored.
  useEffect(
    () =>
      api.onOcrProgress((value) => {
        const progress = cleanProgress(value);
        if (progress && progress.code === current.current)
          setReceived(progress.received);
      }),
    [],
  );

  const installed = languages.filter((l) => l.installed);
  const available = languages.filter((l) => !l.installed);
  const pick = available.find((l) => l.code === chosen) ?? available[0];

  function download(language: OcrLanguage) {
    if (busy) return;
    void run(async () => {
      setDone(null);
      stopAsked.current = false;
      setStopping(false);
      current.current = language.code;
      setReceived(0);
      setDownloading(language);
      // Said once; the bar is not a live region, so its moves are not read.
      announce(`Downloading ${language.name}.`);
      // The Download button went with its row; Stop is in its place.
      refocusIfLost(() => stopRef.current);
      try {
        setLanguages(await api.downloadOcrLanguage(language.code));
        setChosen("");
        setDone({ ok: true, text: `Downloaded and checked ${language.name}.` });
      } catch (e) {
        if (!stopAsked.current) throw e;
        setDone({
          ok: false,
          text: `Stopped downloading ${language.name}. Nothing was kept.`,
        });
      } finally {
        current.current = "";
        setDownloading(null);
        refocusIfLost(() => selectRef.current);
      }
    });
  }

  function stop(language: OcrLanguage) {
    if (stopAsked.current) return;
    stopAsked.current = true;
    setStopping(true);
    api.cancelOcrLanguage(language.code).catch(() => {
      // The download may have just ended on its own; its own line says so.
    });
  }

  const percent = downloading ? progressPercent(received, downloading.size) : 0;

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
                      setDone(null);
                      setLanguages(await api.removeOcrLanguage(l.code));
                      setDone({ ok: true, text: `Removed ${l.name}.` });
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
      {downloading ? (
        // Takes the place of the row below, at the same height: nothing moves.
        <div className="wrap reading-row">
          <span id={barId}>Downloading {downloading.name}</span>
          <div
            className="download-track"
            role="progressbar"
            aria-labelledby={barId}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}%, ${fileSize(received)} of ${fileSize(downloading.size)}`}
          >
            <div
              className="download-fill"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <span className="download-figure faint" aria-hidden="true">
            {percent}%
          </span>
          <button
            ref={stopRef}
            type="button"
            className="btn"
            aria-label={`Stop downloading ${downloading.name}`}
            aria-disabled={stopping || undefined}
            onClick={() => stop(downloading)}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      ) : pick ? (
        <div className="wrap reading-row">
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
          <button
            type="button"
            className="btn"
            aria-disabled={busy || undefined}
            onClick={() => download(pick)}
          >
            Download {pick.name} ({fileSize(pick.size)})
          </button>
        </div>
      ) : null}
      {/* The end, said once by this region; the line itself is no second region. */}
      <div aria-live="polite">
        {done?.ok ? (
          <OkLine parentAnnounces>{done.text}</OkLine>
        ) : done ? (
          <span className="faint">{done.text}</span>
        ) : null}
      </div>
      <ErrorLine>{error}</ErrorLine>
    </Section>
  );
}
