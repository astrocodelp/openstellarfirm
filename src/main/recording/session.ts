import {
  isJpeg,
  isNewPicture,
  looksPrivate,
  MAX_FRAME_BYTES,
  MAX_FRAMES,
  MAX_RECORDING_MS,
  type RecordFrame,
  type RecordStatus,
  type RecordStopReason,
  SAMPLE_MS,
} from "../../shared/recording";

/**
 * One recording at a time, held in memory and nowhere else. No video is ever
 * written: the screen is looked at every two seconds and a picture is kept
 * only when it changed. The pictures are dropped when the person clears the
 * recording, starts another, saves a skill, or quits.
 *
 * What it will not keep, when it can tell: a look at the whole screen while
 * OpenStellarFirm itself is in front (it can show a key being typed), and a
 * look at a window whose title reads like a password manager.
 */

/** One look at the screen or a window, as the capture code hands it over. */
export interface Grab {
  /** The window's title at this moment; a screen has its own name. */
  title: string;
  /** The small grayscale grid the change is judged on. */
  grid: Uint8Array;
  /** The picture as a JPEG within the size limits, or nothing if it cannot be. */
  encode(): Uint8Array | undefined;
  /** A small copy for the strip, as a data address. */
  thumb(): string;
}

export interface PickedSource {
  id: string;
  name: string;
  kind: "screen" | "window";
}

export interface SessionDeps {
  grab(source: PickedSource): Promise<Grab | undefined>;
  /** True while this app's own window is the one in front. */
  ownInFront(): boolean;
  /** A small copy of a picture from a video, for the strip. */
  thumbOf(jpeg: Uint8Array): string;
  now(): number;
  /** Runs `run` every `ms` until the returned function is called. */
  every(ms: number, run: () => void): () => void;
  id(): string;
  onChange(status: RecordStatus): void;
}

interface Kept {
  id: string;
  atMs: number;
  jpeg: Uint8Array;
  thumb: string;
}

/** Looks in a row that found nothing before the recording stops. */
const MAX_MISSES = 3;
/** The longest a video may be looked into, in milliseconds. */
const MAX_VIDEO_MS = 24 * 60 * 60 * 1000;

export class RecordError extends Error {}

export class RecordingSession {
  private frames: Kept[] = [];
  private source: PickedSource | undefined;
  private kind: RecordStatus["kind"];
  private startedAt = 0;
  private elapsed = 0;
  private skipped = 0;
  private misses = 0;
  private lastGrid: Uint8Array | undefined;
  private cancel: (() => void) | undefined;
  private busy = false;
  private stopped: RecordStopReason | undefined;
  private drafting: RecordStatus["drafting"];

  constructor(private readonly deps: SessionDeps) {}

  get recording(): boolean {
    return this.cancel !== undefined;
  }

  status(): RecordStatus {
    return {
      recording: this.recording,
      ...(this.source ? { sourceName: this.source.name } : {}),
      ...(this.kind ? { kind: this.kind } : {}),
      elapsedMs: this.recording
        ? Math.min(MAX_RECORDING_MS, this.deps.now() - this.startedAt)
        : this.elapsed,
      maxMs: MAX_RECORDING_MS,
      frames: this.frames.map(
        (f): RecordFrame => ({ id: f.id, atMs: f.atMs, thumb: f.thumb }),
      ),
      skipped: this.skipped,
      ...(this.stopped ? { stopped: this.stopped } : {}),
      ...(this.drafting ? { drafting: { ...this.drafting } } : {}),
    };
  }

  private changed(): RecordStatus {
    const status = this.status();
    this.deps.onChange(status);
    return status;
  }

  private forget(): void {
    this.frames = [];
    this.source = undefined;
    this.kind = undefined;
    this.elapsed = 0;
    this.skipped = 0;
    this.misses = 0;
    this.lastGrid = undefined;
    this.stopped = undefined;
  }

  /** Starts a new recording of the source the person picked. */
  start(source: PickedSource): RecordStatus {
    if (this.recording) throw new RecordError("It is recording already.");
    if (this.drafting)
      throw new RecordError("Wait for the draft, or stop it first.");
    if (looksPrivate(source.name))
      throw new RecordError(
        "That window reads like a password manager, so it cannot be recorded.",
      );
    this.forget();
    this.source = source;
    this.kind = source.kind;
    this.startedAt = this.deps.now();
    this.cancel = this.deps.every(SAMPLE_MS, () => {
      void this.tick();
    });
    // The first look straight away, so the strip is never empty for long.
    void this.tick();
    return this.changed();
  }

  stop(reason: RecordStopReason = "person"): RecordStatus {
    if (!this.recording) return this.status();
    this.cancel?.();
    this.cancel = undefined;
    this.elapsed = Math.min(MAX_RECORDING_MS, this.deps.now() - this.startedAt);
    this.stopped = reason;
    return this.changed();
  }

  /** One look. Public so the tests can drive it without a clock. */
  async tick(): Promise<void> {
    const source = this.source;
    if (!this.recording || !source || this.busy) return;
    if (this.deps.now() - this.startedAt >= MAX_RECORDING_MS) {
      this.stop("time");
      return;
    }
    this.busy = true;
    try {
      // OpenStellarFirm in front can show a key being typed: never kept. One
      // other window's recording cannot show this app, so it is not skipped.
      if (source.kind === "screen" && this.deps.ownInFront()) {
        this.skipped += 1;
        this.changed();
        return;
      }
      let grab: Grab | undefined;
      try {
        grab = await this.deps.grab(source);
      } catch {
        grab = undefined;
      }
      if (!this.recording) return;
      if (!grab) {
        this.misses += 1;
        if (this.misses >= MAX_MISSES) this.stop("gone");
        return;
      }
      this.misses = 0;
      if (source.kind === "window" && looksPrivate(grab.title)) {
        this.skipped += 1;
        this.changed();
        return;
      }
      if (!isNewPicture(this.lastGrid, grab.grid)) {
        this.changed();
        return;
      }
      const jpeg = grab.encode();
      if (!jpeg || !isJpeg(jpeg) || jpeg.length > MAX_FRAME_BYTES) return;
      this.lastGrid = grab.grid;
      this.frames.push({
        id: this.deps.id(),
        atMs: Math.max(0, this.deps.now() - this.startedAt),
        jpeg,
        thumb: grab.thumb(),
      });
      if (this.frames.length >= MAX_FRAMES) this.stop("frames");
      else this.changed();
    } finally {
      this.busy = false;
    }
  }

  /**
   * One picture the page took from a video the person picked. The page keeps
   * only changed pictures; here each is checked again before it is held.
   */
  addVideoFrame(jpegBase64: unknown, atMs: unknown): RecordStatus {
    if (this.recording) throw new RecordError("Stop the recording first.");
    if (this.drafting)
      throw new RecordError("Wait for the draft, or stop it first.");
    if (
      typeof jpegBase64 !== "string" ||
      jpegBase64.length > Math.ceil((MAX_FRAME_BYTES * 4) / 3) + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(jpegBase64)
    )
      throw new RecordError("That picture is not allowed.");
    if (
      typeof atMs !== "number" ||
      !Number.isFinite(atMs) ||
      atMs < 0 ||
      atMs > MAX_VIDEO_MS
    )
      throw new RecordError("That picture is not allowed.");
    const jpeg = new Uint8Array(Buffer.from(jpegBase64, "base64"));
    if (!isJpeg(jpeg) || jpeg.length > MAX_FRAME_BYTES)
      throw new RecordError("That picture is not allowed.");
    if (this.kind !== "video") {
      this.forget();
      this.kind = "video";
      this.source = { id: "video", name: "A video you picked", kind: "screen" };
    }
    if (this.frames.length >= MAX_FRAMES)
      throw new RecordError(
        `A recording keeps at most ${MAX_FRAMES} pictures. Remove some to add more.`,
      );
    this.frames.push({
      id: this.deps.id(),
      atMs: Math.round(atMs),
      jpeg,
      thumb: this.deps.thumbOf(jpeg),
    });
    this.elapsed = Math.max(this.elapsed, Math.round(atMs));
    return this.changed();
  }

  removeFrame(frameId: unknown): RecordStatus {
    if (this.drafting)
      throw new RecordError("Wait for the draft, or stop it first.");
    this.frames = this.frames.filter((f) => f.id !== frameId);
    return this.changed();
  }

  /** Forgets the recording and every picture in it. */
  clear(): RecordStatus {
    if (this.drafting)
      throw new RecordError("Wait for the draft, or stop it first.");
    this.cancel?.();
    this.cancel = undefined;
    this.forget();
    return this.changed();
  }

  /** The kept pictures, in order, for a draft. */
  pictures(): { atMs: number; jpeg: Uint8Array }[] {
    return this.frames.map((f) => ({ atMs: f.atMs, jpeg: f.jpeg }));
  }

  setDrafting(progress: RecordStatus["drafting"]): void {
    this.drafting = progress;
    this.changed();
  }
}
