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
}: {
  onCopy(): Promise<void>;
  onError(message: string): void;
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
        aria-label={copied ? "Copied" : "Copy this answer"}
        title="Copy this answer"
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

/** "Save this chat": the system's save dialog, then a short "Saved". */
export function SaveChatButton({
  disabled,
  onSave,
  onError,
}: {
  disabled: boolean;
  onSave(): Promise<boolean>;
  onError(message: string): void;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save() {
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
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={disabled || state === "saving"}
        title={
          disabled ? "There is nothing in this chat to save yet" : undefined
        }
        onClick={() => void save()}
      >
        <Icon name={state === "saved" ? "check" : "download"} size={16} />
        {state === "saving"
          ? "Saving…"
          : state === "saved"
            ? "Saved"
            : "Save this chat"}
      </button>
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
    const bubble = el.matches(".bubble")
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
    bubble.dataset.found = "true";
    // Not cleared with the effect: the light must go even if the chat changes.
    setTimeout(() => {
      delete bubble.dataset.found;
    }, FOUND_FOR);
  });
}
