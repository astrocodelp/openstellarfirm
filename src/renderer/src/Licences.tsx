import { useEffect, useId, useState } from "react";
import { Modal } from "./OwnSkills";

/**
 * The full licence texts of the work of others inside the app. The build
 * writes them to dist/THIRD-PARTY-LICENSES.txt (scripts/licences.mjs) before
 * the page is built, and the page carries them as a separate file loaded only
 * when the person opens them. The same file sits beside the installed app.
 */
const texts = import.meta.glob<string>(
  "../../../dist/THIRD-PARTY-LICENSES.txt",
  {
    query: "?raw",
    import: "default",
  },
);

async function loadLicences(): Promise<string | null> {
  const load = Object.values(texts)[0];
  return load ? load() : null;
}

/** A button that opens the licence texts in a dialog. */
export function LicencesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Licences of others' work
      </button>
      {open ? <LicencesDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function LicencesDialog({ onClose }: { onClose(): void }) {
  const titleId = useId();
  // undefined while it loads, null when this build has no file (the browser preview).
  const [text, setText] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadLicences()
      .then((found) => {
        if (live) setText(found);
      })
      .catch(() => {
        if (live) setText(null);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      <div className="modal-body stack">
        <div className="modal-head">
          <h2 className="section-title" id={titleId}>
            Licences of others' work
          </h2>
          {/* The first control, so the focus lands on it when the dialog opens. */}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="faint">
          Fonts, React, Electron, PDF.js and Tesseract.js, as in
          THIRD-PARTY-LICENSES.txt beside the app's files.
        </p>
        {text === undefined ? (
          <p className="faint" role="status">
            Opening the licences…
          </p>
        ) : text === null ? (
          <p className="faint">
            Built without the licence file: run pnpm build, or read
            THIRD-PARTY-NOTICES.md in the source.
          </p>
        ) : (
          <section
            className="licences-text"
            aria-label="Licence texts"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must take the focus
            tabIndex={0}
          >
            <pre>{text}</pre>
          </section>
        )}
      </div>
    </Modal>
  );
}
