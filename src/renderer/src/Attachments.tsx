import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useState,
} from "react";
import type {
  AttachmentKind,
  AttachmentRef,
  PendingAttachment,
} from "../../shared/types";
import { api } from "./bridge";
import { message as errorText, Icon } from "./ui";

/**
 * Files on a message: the attach button, drag and drop, pasting a picture,
 * the chips in the box before sending, and the chips on a sent message.
 *
 * The page only ever hands the app bytes it read itself. It never names a
 * path: the file picker is opened by the app, and a sent file opens only
 * through the app, by its id, on the person's click.
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindLabel(kind: AttachmentKind, pages?: number): string {
  if (kind === "pdf")
    return pages ? `PDF, ${pages} ${pages === 1 ? "page" : "pages"}` : "PDF";
  if (kind === "text") return "Text";
  return "Picture";
}

function PaperClip({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </svg>
  );
}

function KindMark({ kind }: { kind: AttachmentKind }) {
  return (
    <span className="attach-mark" aria-hidden="true">
      {kind === "pdf" ? "PDF" : kind === "text" ? "TXT" : "IMG"}
    </span>
  );
}

/** The files waiting in one assistant's box, kept by the app. */
export function useAttachments(assistantId: string) {
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(0);

  useEffect(() => {
    let live = true;
    setProblem("");
    setNote("");
    api
      .pendingAttachments(assistantId)
      .then((list) => {
        if (live) setFiles(list);
      })
      .catch(() => {
        if (live) setFiles([]);
      });
    return () => {
      live = false;
    };
  }, [assistantId]);

  function announce(added: number, problems: string[]) {
    setProblem(problems.join(" "));
    setNote(
      added > 0 ? `Attached ${added} ${added === 1 ? "file" : "files"}.` : "",
    );
  }

  async function pick() {
    setAdding((n) => n + 1);
    try {
      const picked = await api.pickAttachments(assistantId);
      setFiles((list) => [...list, ...picked.added]);
      announce(picked.added.length, picked.problems);
    } catch (e) {
      announce(0, [errorText(e)]);
    } finally {
      setAdding((n) => n - 1);
    }
  }

  /** Files from a drop or a paste: the page reads their bytes and hands them over. */
  async function addFiles(list: File[]) {
    if (list.length === 0) return;
    const problems: string[] = [];
    let added = 0;
    setAdding((n) => n + 1);
    try {
      for (const file of list.slice(0, MAX_FILES)) {
        if (file.size > MAX_FILE_BYTES) {
          problems.push(
            `${file.name}: That file is too large. Attach one of at most 20 MB.`,
          );
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const one = await api.addAttachment(
            assistantId,
            file.name || "pasted picture",
            bytes,
          );
          setFiles((now) => [...now, one]);
          added += 1;
        } catch (e) {
          problems.push(`${file.name || "That file"}: ${errorText(e)}`);
        }
      }
      if (list.length > MAX_FILES)
        problems.push(
          `A message can carry up to ${MAX_FILES} files, so the rest were left out.`,
        );
    } finally {
      setAdding((n) => n - 1);
      announce(added, problems);
    }
  }

  async function remove(file: PendingAttachment) {
    setFiles((list) => list.filter((f) => f.id !== file.id));
    setNote(`Removed ${file.name}.`);
    await api.removeAttachment(assistantId, file.id).catch(() => undefined);
  }

  /** After a send, the box holds what the app still keeps (nothing, normally). */
  async function reload() {
    setFiles(await api.pendingAttachments(assistantId).catch(() => []));
    setNote("");
  }

  return {
    files,
    problem,
    note,
    adding: adding > 0,
    pick,
    addFiles,
    remove,
    reload,
    clearProblem: () => setProblem(""),
  };
}

export type AttachmentBox = ReturnType<typeof useAttachments>;

/** The paper clip in the box. It asks the app to open the system's file picker. */
export function AttachButton({
  box,
  disabled,
}: {
  box: AttachmentBox;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-btn attach-btn"
      aria-label="Attach files"
      title="Attach files"
      disabled={disabled || box.adding}
      onClick={() => void box.pick()}
    >
      <PaperClip />
    </button>
  );
}

/** The files waiting in the box, each with a way to take it out. */
export function PendingFiles({ box }: { box: AttachmentBox }) {
  if (box.files.length === 0 && !box.adding) return null;
  return (
    <ul className="attach-chips" aria-label="Files to send">
      {box.files.map((file) => (
        <li key={file.id} className="attach-chip">
          {file.preview ? (
            <img className="attach-thumb" src={file.preview} alt="" />
          ) : (
            <KindMark kind={file.kind} />
          )}
          <span className="attach-text">
            <span className="attach-name">{file.name}</span>
            <span className="attach-meta">
              {kindLabel(file.kind, file.pages)} · {fileSize(file.size)}
            </span>
          </span>
          <button
            type="button"
            className="attach-remove"
            aria-label={`Remove ${file.name}`}
            title="Remove"
            onClick={() => void box.remove(file)}
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      ))}
      {box.adding ? (
        <li className="attach-chip attach-busy">
          <span className="attach-meta">Checking the file…</span>
        </li>
      ) : null}
    </ul>
  );
}

/** The files on a sent message. Each opens with the system's own app, on a click. */
export function SentFiles({
  assistantId,
  files,
}: {
  assistantId: string;
  files: AttachmentRef[];
}) {
  const [problem, setProblem] = useState("");
  return (
    <div className="attach-sent">
      <ul className="attach-chips" aria-label="Files sent with this message">
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              className="attach-chip attach-open"
              title={`Open ${file.name}`}
              onClick={() => {
                setProblem("");
                api
                  .openAttachment(assistantId, file.id)
                  .catch((e) => setProblem(errorText(e)));
              }}
            >
              <KindMark kind={file.kind} />
              <span className="attach-text">
                <span className="attach-name">{file.name}</span>
                <span className="attach-meta">
                  {kindLabel(file.kind, file.pages)} · {fileSize(file.size)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {problem ? (
        <p className="attach-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * Drag and drop onto the chat. While files are over it, a plain line says
 * what will happen. Anything that is not a file is left to the page.
 */
export function useDropFiles(box: AttachmentBox, enabled: boolean) {
  const [over, setOver] = useState(false);
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent) => {
        if (!enabled || !hasFiles(event)) return;
        event.preventDefault();
        setOver(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!enabled || !hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (event: DragEvent) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (!enabled || !hasFiles(event)) return;
        event.preventDefault();
        void box.addFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}

/**
 * Pasting a picture, or a file copied elsewhere, attaches it; pasting text
 * stays text. The app checks what each file really is.
 */
export function pastedFiles(event: ClipboardEvent): File[] {
  return Array.from(event.clipboardData?.files ?? []);
}
