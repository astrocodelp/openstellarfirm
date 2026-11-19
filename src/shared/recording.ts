/**
 * Record how you work: the rules both sides share. The main process samples
 * the screen and the page samples a video file the person picked, and both
 * keep a picture only when it changed. No model decides what is kept.
 *
 * Pure: no Node, DOM or Electron imports, so it is tested offline.
 */

/** How often the screen or a video is looked at. */
export const SAMPLE_MS = 2000;
/** The longest a live recording runs. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;
/** The most pictures one recording keeps. Past this it stops. */
export const MAX_FRAMES = 60;
/** The most pictures in one model call. */
export const PICTURES_A_CALL = 3;
/** Said when a model did not take or did not read the pictures. */
export const NO_PICTURES_LINE =
  "This model did not read the pictures. It may not read pictures at all. Pick a model that does, and try again.";

/** The longest side of a kept picture, and its largest size. */
export const FRAME_SIDE = 1280;
export const MAX_FRAME_BYTES = 1_000_000;
/** The words the person may add about what they were doing. */
export const MAX_NOTES = 1000;
/** The most looks a video gets, however long it is. */
export const MAX_VIDEO_SAMPLES = MAX_RECORDING_MS / SAMPLE_MS;

/** The small grayscale grid a change is judged on. */
export const GRID_COLS = 48;
export const GRID_ROWS = 27;
/** A cell counts as changed when its gray level moved by more than this. */
const CELL_DELTA = 10;
/** A picture counts as new when at least this many cells changed. */
const MIN_CHANGED_CELLS = 6;

/**
 * Gray levels from 4-byte pixels. Electron's bitmaps are BGRA and a canvas's
 * are RGBA, so the order is named. The weights are the usual luma ones.
 */
export function toGray(
  pixels: Uint8Array | Uint8ClampedArray,
  order: "rgba" | "bgra",
): Uint8Array {
  const count = Math.floor(pixels.length / 4);
  const gray = new Uint8Array(count);
  const r = order === "rgba" ? 0 : 2;
  const b = order === "rgba" ? 2 : 0;
  for (let i = 0; i < count; i += 1) {
    const at = i * 4;
    gray[i] = Math.round(
      0.299 * (pixels[at + r] ?? 0) +
        0.587 * (pixels[at + 1] ?? 0) +
        0.114 * (pixels[at + b] ?? 0),
    );
  }
  return gray;
}

/** How many cells of two grids differ by more than a small step. */
export function changedCells(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > CELL_DELTA) changed += 1;
  }
  return changed;
}

/**
 * True when the next look is worth keeping: the first one, or one that
 * differs from the last kept picture in enough of the screen. A blinking
 * cursor or a clock changes a cell or two and is not kept.
 */
export function isNewPicture(
  lastKept: Uint8Array | undefined,
  next: Uint8Array,
): boolean {
  if (!lastKept) return true;
  return changedCells(lastKept, next) >= MIN_CHANGED_CELLS;
}

/** Splits a list into groups of at most `size`, in order. */
export function batches<T>(items: T[], size = PICTURES_A_CALL): T[][] {
  if (size < 1) throw new Error("A batch holds at least one item.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** How many model calls a draft takes: one per batch, then one to write it. */
export function callsFor(pictures: number): number {
  return pictures === 0 ? 0 : Math.ceil(pictures / PICTURES_A_CALL) + 1;
}

/**
 * The moments a video is looked at, in seconds: every two seconds, or spread
 * evenly when the video is long, so the whole of it is covered.
 */
export function videoSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const step = Math.max(
    SAMPLE_MS / 1000,
    duration / Math.max(1, MAX_VIDEO_SAMPLES),
  );
  const times: number[] = [];
  for (let t = 0; t < duration && times.length < MAX_VIDEO_SAMPLES; t += step) {
    times.push(Math.round(t * 1000) / 1000);
  }
  return times;
}

/**
 * Window titles that read like a password manager. A picture is never kept
 * while such a window is the one being recorded, and it cannot be picked.
 */
const PRIVATE_TITLE =
  /\b(1password|bitwarden|keepass(xc)?|lastpass|dashlane|keychain access|passwords?|enpass|nordpass|proton pass|keeper|roboform|password manager|authenticator)\b/i;

export function looksPrivate(title: string): boolean {
  return PRIVATE_TITLE.test(title);
}

/** "1:05", for a time on the recording. */
export function clockOf(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** True when the bytes start like a JPEG file. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** A screen or a window the person may record. */
export interface RecordSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  /** A small picture of it, as a data address; empty when there is none. */
  thumb: string;
  /** True when its title reads like a password manager: it is not offered. */
  private: boolean;
}

/** One kept picture, as the page sees it: a small copy, never the full one. */
export interface RecordFrame {
  id: string;
  /** Milliseconds from the start of the recording or the video. */
  atMs: number;
  thumb: string;
}

export type RecordStopReason =
  | "person"
  | "time"
  | "frames"
  | "gone"
  | "private";

export interface RecordStatus {
  recording: boolean;
  /** What is being or was recorded, as plain text. */
  sourceName?: string;
  kind?: "screen" | "window" | "video";
  elapsedMs: number;
  maxMs: number;
  frames: RecordFrame[];
  /** Looks that were not kept because something private was in front. */
  skipped: number;
  stopped?: RecordStopReason;
  /** While a draft is being written: how many model calls are done. */
  drafting?: { done: number; total: number };
}

/** What a draft will send, and where, said before anything is sent. */
export interface RecordPlan {
  pictures: number;
  calls: number;
  /** The source's name and the model, such as "Ollama · llava". */
  model: string;
  /** "on this computer", or the service's name. */
  where: string;
  local: boolean;
  sourceId: string;
}
