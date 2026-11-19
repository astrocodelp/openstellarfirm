/**
 * How far a download has got, and how often the page hears about it. Pure, so
 * both sides use the same rules and the rules are tested offline.
 */

/** One reading language's download, sent from the main process to the page. */
export interface OcrDownloadProgress {
  /** The language's code, from the pinned list. */
  code: string;
  /** Bytes received so far. */
  received: number;
  /** Bytes expected, from the pinned list, never from the server. */
  total: number;
}

/** About ten updates a second: enough to move a bar, not enough to flood. */
export const PROGRESS_INTERVAL_MS = 100;

/**
 * The share received, as a whole number from 0 to 100. It says 100 only once
 * every byte is in, so a bar never looks finished while the file is still
 * arriving, and a nonsense value reads as 0.
 */
export function progressPercent(received: number, total: number): number {
  if (!Number.isFinite(received) || !Number.isFinite(total) || total <= 0)
    return 0;
  if (received <= 0) return 0;
  if (received >= total) return 100;
  return Math.min(99, Math.floor((received / total) * 100));
}

export interface ProgressThrottle<T> {
  /** Sends the value when the last one went at least an interval ago. */
  push(value: T): void;
  /** Always sends: the first and the last value must never be dropped. */
  flush(value: T): void;
}

/**
 * Lets through at most one update an interval. A value that arrives too soon
 * is dropped, not queued: the next one carries newer numbers anyway, and
 * `flush` sends the last one.
 */
export function progressThrottle<T>(
  send: (value: T) => void,
  intervalMs: number = PROGRESS_INTERVAL_MS,
  now: () => number = Date.now,
): ProgressThrottle<T> {
  let last: number | undefined;
  return {
    push(value) {
      const at = now();
      if (last !== undefined && at - last < intervalMs) return;
      last = at;
      send(value);
    },
    flush(value) {
      last = now();
      send(value);
    },
  };
}

/**
 * A progress update from the main process, checked before the page uses it:
 * a known code and whole, finite, non-negative numbers. Anything else is
 * undefined and ignored.
 */
export function cleanProgress(value: unknown): OcrDownloadProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { code, received, total } = value as Record<string, unknown>;
  if (typeof code !== "string" || code.length === 0 || code.length > 16)
    return undefined;
  if (!isCount(received) || !isCount(total) || total === 0) return undefined;
  return { code, received: Math.min(received, total), total };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
