import {
  FRAME_SIDE,
  GRID_COLS,
  GRID_ROWS,
  isNewPicture,
  MAX_FRAME_BYTES,
  MAX_FRAMES,
  toGray,
  videoSampleTimes,
} from "../../shared/recording";

/**
 * A video the person already has, looked through in the page: a hidden video
 * element plays from a blob address made from their file, a picture is taken
 * every two seconds, and only a changed one is handed on. The file itself is
 * never sent anywhere and never copied; the address is dropped at the end.
 */

export class VideoError extends Error {}

export interface VideoResult {
  kept: number;
  /** True when it stopped at the most pictures a recording keeps. */
  full: boolean;
}

function once(
  target: HTMLVideoElement,
  ok: string,
  signal: AbortSignal,
  ms = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onOk = () => {
      done();
      resolve();
    };
    const onError = () => {
      done();
      reject(
        new VideoError(
          "This video cannot be read here. Try an MP4 or WebM file.",
        ),
      );
    };
    const onAbort = () => {
      done();
      reject(new VideoError("Stopped."));
    };
    const timer = setTimeout(() => {
      done();
      reject(new VideoError("The video took too long to read."));
    }, ms);
    target.addEventListener(ok, onOk, { once: true });
    target.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new VideoError("A picture failed.")),
      "image/jpeg",
      quality,
    );
  });
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

/** The picture now in the video, as a JPEG within the limits. */
async function jpegOf(video: HTMLVideoElement): Promise<string | undefined> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  for (const side of [FRAME_SIDE, 1024, 768]) {
    const scale = Math.min(1, side / Math.max(width, height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.75, 0.6, 0.45]) {
      const blob = await toBlob(canvas, quality);
      if (blob.size <= MAX_FRAME_BYTES)
        return base64(new Uint8Array(await blob.arrayBuffer()));
    }
  }
  return undefined;
}

export async function sampleVideo(
  file: File,
  options: {
    signal: AbortSignal;
    onProgress(share: number): void;
    send(jpeg: string, atMs: number): Promise<void>;
  },
): Promise<VideoResult> {
  if (
    !file.type.startsWith("video/") &&
    !/\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)
  )
    throw new VideoError("Pick a video file, such as an MP4 or WebM.");
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const grid = document.createElement("canvas");
  grid.width = GRID_COLS;
  grid.height = GRID_ROWS;
  const gridContext = grid.getContext("2d", { willReadFrequently: true });
  let kept = 0;
  let last: Uint8Array | undefined;
  try {
    video.src = url;
    await once(video, "loadedmetadata", options.signal);
    if (!video.videoWidth || !video.videoHeight)
      throw new VideoError("This file has no picture to look at.");
    // Some recordings (a WebM from a browser) give no length until the end is
    // asked for. Seeking far ahead makes the browser find it.
    if (!Number.isFinite(video.duration)) {
      video.currentTime = Number.MAX_SAFE_INTEGER;
      await once(video, "seeked", options.signal);
    }
    const times = videoSampleTimes(video.duration);
    if (times.length === 0)
      throw new VideoError("This video has no length to look through.");
    for (const [index, time] of times.entries()) {
      if (options.signal.aborted) throw new VideoError("Stopped.");
      video.currentTime = time;
      await once(video, "seeked", options.signal);
      gridContext?.drawImage(video, 0, 0, GRID_COLS, GRID_ROWS);
      const pixels = gridContext?.getImageData(0, 0, GRID_COLS, GRID_ROWS).data;
      const next = pixels ? toGray(pixels, "rgba") : undefined;
      if (next && isNewPicture(last, next)) {
        const jpeg = await jpegOf(video);
        if (jpeg) {
          await options.send(jpeg, Math.round(time * 1000));
          last = next;
          kept += 1;
          if (kept >= MAX_FRAMES) {
            options.onProgress(1);
            return { kept, full: true };
          }
        }
      }
      options.onProgress((index + 1) / times.length);
    }
    return { kept, full: false };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
