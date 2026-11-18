/** Small settings choices, checked the same way in the main process and the page. */

export const TEXT_SIZES = ["small", "default", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = "default";

export function isTextSize(value: unknown): value is TextSize {
  return TEXT_SIZES.some((t) => t === value);
}

/** An old file, or anything else unknown, reads as the default size. */
export function cleanTextSize(value: unknown): TextSize {
  return isTextSize(value) ? value : DEFAULT_TEXT_SIZE;
}

/** What sends a message: Enter, or Ctrl (Cmd on a Mac) with Enter. */
export const SEND_KEYS = ["enter", "mod-enter"] as const;
export type SendKey = (typeof SEND_KEYS)[number];
export const DEFAULT_SEND_KEY: SendKey = "enter";

export function isSendKey(value: unknown): value is SendKey {
  return SEND_KEYS.some((k) => k === value);
}

export function cleanSendKey(value: unknown): SendKey {
  return isSendKey(value) ? value : DEFAULT_SEND_KEY;
}

/** The hint under the message box, which follows the choice. */
export function sendHint(sendWith: SendKey, mac: boolean): string {
  const mod = mac ? "Cmd" : "Ctrl";
  return sendWith === "enter"
    ? "Enter sends. Shift+Enter makes a new line."
    : `${mod}+Enter sends. Enter makes a new line.`;
}

/** Whether this key press sends the message, for the chosen way of sending. */
export function sendsMessage(
  sendWith: SendKey,
  key: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
): boolean {
  if (key.key !== "Enter") return false;
  if (sendWith === "enter")
    return !key.shiftKey && !key.ctrlKey && !key.metaKey;
  return key.ctrlKey || key.metaKey;
}
