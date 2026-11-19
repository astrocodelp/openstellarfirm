import {
  type BrowserWindow,
  desktopCapturer,
  type NativeImage,
  nativeImage,
  screen,
} from "electron";
import {
  FRAME_SIDE,
  GRID_COLS,
  GRID_ROWS,
  looksPrivate,
  MAX_FRAME_BYTES,
  type RecordSource,
  toGray,
} from "../../shared/recording";
import type { Grab, PickedSource } from "./session";

/**
 * The real capture, through Electron's own `desktopCapturer`, in the main
 * process. The page never gets a stream or a capture permission: it only sees
 * the list of sources and the small copies of the pictures kept. Nothing here
 * writes a file.
 */

const THUMB_WIDTH = 200;
const LIST_THUMB = { width: 320, height: 200 };

function sideOf(image: NativeImage, side: number): NativeImage {
  const { width, height } = image.getSize();
  const scale = Math.min(1, side / Math.max(width, height, 1));
  return scale < 1
    ? image.resize({
        width: Math.max(1, Math.round(width * scale)),
        quality: "good",
      })
    : image;
}

/** A JPEG no larger than the limits, trying smaller sizes and lower quality. */
export function encodeWithin(image: NativeImage): Uint8Array | undefined {
  for (const side of [FRAME_SIDE, 1024, 768]) {
    const sized = sideOf(image, side);
    for (const quality of [75, 60, 45]) {
      const bytes = sized.toJPEG(quality);
      if (bytes.length > 0 && bytes.length <= MAX_FRAME_BYTES)
        return new Uint8Array(bytes);
    }
  }
  return undefined;
}

function thumbOfImage(image: NativeImage): string {
  const small = image.resize({ width: THUMB_WIDTH, quality: "good" });
  return `data:image/jpeg;base64,${small.toJPEG(60).toString("base64")}`;
}

function gridOf(image: NativeImage): Uint8Array {
  const small = image.resize({
    width: GRID_COLS,
    height: GRID_ROWS,
    quality: "good",
  });
  // Electron's bitmaps are BGRA on every platform it supports.
  return toGray(small.toBitmap(), "bgra");
}

/** A name for the person, as one short line. */
function nameOf(name: string): string {
  return (
    name
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "A window"
  );
}

function kindOf(id: string): "screen" | "window" {
  return id.startsWith("screen:") ? "screen" : "window";
}

/** The screens and windows that may be recorded. This app's own window is never one. */
export async function listSources(own: BrowserWindow): Promise<RecordSource[]> {
  const ownId = own.getMediaSourceId();
  // When the system does not let the app see the screen (macOS without Screen
  // Recording allowed), the list is empty and the page says where to allow
  // it, instead of a bare "Something went wrong."
  const sources = await desktopCapturer
    .getSources({ types: ["screen", "window"], thumbnailSize: LIST_THUMB })
    .catch(() => []);
  return sources
    .filter((s) => s.id !== ownId)
    .map((s) => ({
      id: s.id,
      name: nameOf(s.name),
      kind: kindOf(s.id),
      thumb: s.thumbnail.isEmpty() ? "" : s.thumbnail.toDataURL(),
      private: looksPrivate(s.name),
    }));
}

/** The source the person picked, looked up again so the page cannot name another. */
export async function pickSource(
  own: BrowserWindow,
  id: string,
): Promise<PickedSource> {
  const found = (await listSources(own)).find((s) => s.id === id);
  if (!found)
    throw new Error("That screen or window is no longer there. Pick again.");
  if (found.private)
    throw new Error(
      "That window reads like a password manager, so it cannot be recorded.",
    );
  return { id: found.id, name: found.name, kind: found.kind };
}

/** The size a screen is asked for: its own shape, the longer side at most FRAME_SIDE. */
function screenSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().size;
  const scale = Math.min(1, FRAME_SIDE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** One look at the picked source, or nothing when it is gone or empty. */
export async function grabSource(
  source: PickedSource,
): Promise<Grab | undefined> {
  const sources = await desktopCapturer.getSources({
    types: [source.kind],
    thumbnailSize:
      source.kind === "screen"
        ? screenSize()
        : { width: FRAME_SIDE, height: FRAME_SIDE },
  });
  const found = sources.find((s) => s.id === source.id);
  if (!found || found.thumbnail.isEmpty()) return undefined;
  const image = found.thumbnail;
  return {
    title: found.name,
    grid: gridOf(image),
    encode: () => encodeWithin(image),
    thumb: () => thumbOfImage(image),
  };
}

/** A small copy of a picture from a video, for the strip. */
export function thumbOfJpeg(jpeg: Uint8Array): string {
  const image = nativeImage.createFromBuffer(Buffer.from(jpeg));
  return image.isEmpty() ? "" : thumbOfImage(image);
}
