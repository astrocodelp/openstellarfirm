import { type RefObject, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/types";
import { message as errorText, Icon } from "./ui";

/**
 * The chat's own tools: copy an answer, save the whole chat as a file, and
 * bring a message found by a search into view.
 */

/** How long "Copied" and "Saved" stay before the button reads as it was. */
const CONFIRM_FOR = 1600;
/** How long a message found by a search stays lit. */
const FOUND_FOR = 1800;

/** A message a search found, to bring into view once. */
export interface FoundMessage {
  assistantId: string;
  messageId: string;
  /** A new number for each search pick, so the same message can be found twice. */
  nonce: number;
}

function CopyGlyph({ size = 14 }: { size?: number }) {
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
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

/** Copies one answer. The words come from the saved chat, not from the page. */
export function CopyButton({
  onCopy,
  onError,
  label = "Copy this answer",
}: {
  onCopy(): Promise<void>;
  onError(message: string): void;
  /** What it copies, as a screen reader and the tooltip say it. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await onCopy();
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), CONFIRM_FOR);
    } catch (e) {
      onError(errorText(e));
    }
  }

  return (
    <>
      <button
        type="button"
        className="copy-btn"
        aria-label={copied ? "Copied" : label}
        title={label}
        onClick={() => void copy()}
      >
        {copied ? <Icon name="check" size={14} /> : <CopyGlyph />}
        <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
      </button>
      <span className="visually-hidden" role="status">
        {copied ? "Copied to the clipboard." : ""}
      </span>
    </>
  );
}

/**
 * "Save this chat": the system's save dialog, then a short "Saved". The menu
 * item that starts it closes at once, so the state lives here, and the head
 * shows "Saved" for a moment.
 */
export function useSaveChat(
  onSave: (() => Promise<boolean>) | undefined,
  onError: (message: string) => void,
) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** A second press while the save dialog is open does nothing. */
  const saving = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save() {
    if (!onSave || saving.current) return;
    saving.current = true;
    setState("saving");
    try {
      const saved = await onSave();
      if (!saved) {
        setState("idle");
        return;
      }
      setState("saved");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState("idle"), CONFIRM_FOR);
    } catch (e) {
      setState("idle");
      onError(errorText(e));
    } finally {
      saving.current = false;
    }
  }

  return { state, save, can: onSave !== undefined };
}

/** What a save says: a short "Saved" in the head, and a sentence for a screen reader. */
export function SaveChatStatus({
  state,
}: {
  state: "idle" | "saving" | "saved";
}) {
  return (
    <>
      {state === "saved" ? (
        <span className="ok-line head-saved" aria-hidden="true">
          <Icon name="check" size={14} />
          Saved
        </span>
      ) : null}
      <span className="visually-hidden" role="status">
        {state === "saved" ? "The chat was saved as a Markdown file." : ""}
      </span>
    </>
  );
}

/**
 * Brings a message a search found into view, lights it for a moment and puts
 * the focus on it. A pick from the keyboard is answered at once, so the chat
 * jumps there rather than gliding; only the light fades, and with reduced
 * motion it comes and goes without a fade.
 */
export function useFoundMessage(
  found: FoundMessage | undefined,
  messages: ChatMessage[],
  column: RefObject<HTMLElement | null>,
  /** The chat no longer follows the newest text: the person is reading back. */
  onAway: () => void,
) {
  const handled = useRef(0);
  /** The message lit now and the timer that puts its light out. */
  const lit = useRef<{
    el: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    if (!found || handled.current === found.nonce) return;
    if (!messages.some((m) => m.id === found.messageId)) return;
    const root = column.current;
    const el = root?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(found.messageId)}"]`,
    );
    if (!el) return;
    handled.current = found.nonce;
    onAway();
    // A message kept under a summary sits in a closed "Show the earlier
    // messages": it is opened, or the message could not be shown or focused.
    const fold = el.closest("details");
    if (fold && !fold.open) fold.open = true;
    // A summary lights as a whole; its earlier messages' bubbles are not it.
    const bubble = el.matches(".bubble, .summary")
      ? el
      : (el.querySelector<HTMLElement>(".bubble") ?? el);
    bubble.scrollIntoView({ block: "center", behavior: "instant" });
    if (!bubble.hasAttribute("tabindex")) {
      bubble.setAttribute("tabindex", "-1");
      bubble.addEventListener(
        "blur",
        () => bubble.removeAttribute("tabindex"),
        {
          once: true,
        },
      );
    }
    bubble.focus({ preventScroll: true });
    // A second find puts out the first light, so its timer cannot end the new one.
    if (lit.current) {
      clearTimeout(lit.current.timer);
      delete lit.current.el.dataset.found;
    }
    bubble.dataset.found = "true";
    // Not cleared with the effect: the light must go even if the chat changes.
    const timer = setTimeout(() => {
      delete bubble.dataset.found;
      if (lit.current?.el === bubble) lit.current = null;
    }, FOUND_FOR);
    lit.current = { el: bubble, timer };
  });
}
