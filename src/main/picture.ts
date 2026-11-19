import { nativeImage } from "electron";
import type { LoadedFile } from "./attachments";
import type { SniffedFile } from "./file-kind";
import type { ImagePart } from "./wires/common";

/**
 * Pictures a person attaches, scaled and encoded again in this process with
 * Electron's own decoder. Encoding again drops every piece of metadata (where
 * a photo was taken, the camera, comments), so none of it reaches a model.
 *
 * Electron decodes PNG and JPEG everywhere. WebP and GIF are first drawn
 * again as a PNG by the sandboxed reader, then handled the same way.
 */

/** The longer side a picture is sent at, at most. */
export const MAX_SIDE = 1568;
const PREVIEW_SIDE = 160;
/** Above this a PNG is sent as a JPEG instead, so it stays small. */
const PNG_LIMIT = 3_500_000;

type ToPng = (bytes: Uint8Array, mediaType: string) => Promise<Uint8Array>;

async function decoded(
  kind: string,
  bytes: Uint8Array,
  mediaType: string,
  toPng: ToPng,
) {
  const source =
    kind === "png" || kind === "jpeg"
      ? Buffer.from(bytes)
      : Buffer.from(await toPng(bytes, mediaType));
  const image = nativeImage.createFromBuffer(source);
  if (image.isEmpty()) throw new Error("That picture could not be read.");
  return image;
}

function scaled(image: Electron.NativeImage, side: number) {
  const { width, height } = image.getSize();
  const longer = Math.max(width, height);
  if (longer <= side) return image;
  const factor = side / longer;
  return image.resize({
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
    quality: "good",
  });
}

/** The picture as a model gets it: PNG for a PNG, else JPEG. */
export async function modelPicture(
  file: LoadedFile,
  toPng: ToPng,
): Promise<ImagePart> {
  const image = scaled(
    await decoded(file.kind, file.bytes, file.mediaType, toPng),
    MAX_SIDE,
  );
  if (file.kind !== "jpeg") {
    const png = image.toPNG();
    if (png.length <= PNG_LIMIT)
      return { mediaType: "image/png", data: png.toString("base64") };
  }
  return {
    mediaType: "image/jpeg",
    data: image.toJPEG(85).toString("base64"),
  };
}

/** A small preview for the message box, made from the checked bytes. */
export async function previewOf(
  file: SniffedFile,
  bytes: Uint8Array,
  toPng: ToPng,
): Promise<string | undefined> {
  if (file.kind === "pdf" || file.kind === "text") return undefined;
  const image = scaled(
    await decoded(file.kind, bytes, file.mediaType, toPng),
    PREVIEW_SIDE,
  );
  return `data:image/png;base64,${image.toPNG().toString("base64")}`;
}
