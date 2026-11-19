import { decodeImaAdpcm, encodeImaAdpcm } from "./adpcm";
import { PET_LIMITS } from "./limits";
import { PET_LINES, type PetLineId } from "./lines";

/**
 * A voice pack (`.sfvp`) holds every clip one voice says, as raw IMA-ADPCM
 * blocks with no WAV header, so the pet can play a line with no network. All
 * numbers are little-endian:
 *
 * - header, 16 bytes: `"SFVP"`, u16 version (1), u16 clip count, u32 sample
 *   rate (22050), u16 block align (512), u16 reserved (0);
 * - one 36-byte entry per clip: char id[24] (NUL padded, so a 24-character id
 *   has no terminator), u32 offset from the start of the file, u32 length in
 *   bytes, u32 samples;
 * - the clips' blocks.
 */
export const VOICE_PACK_MAGIC = "SFVP";
export const VOICE_PACK_VERSION = 1;
export const VOICE_PACK_HEADER_BYTES = 16;
export const VOICE_PACK_ENTRY_BYTES = 36;
export const VOICE_PACK_ID_BYTES = 24;

/** Where the app serves a voice's pack, relative to its address. */
export function VOICE_PACK_PATH(voice: string): string {
  return `/pets/voice/${voice}.sfvp`;
}

/** The lines the firmware image carries too, in pack order. */
export function bootLineIds(): PetLineId[] {
  return PET_LINES.filter((line) => line.boot).map((line) => line.id);
}

/** A file that is not a voice pack this package reads. */
export class VoicePackFormatError extends Error {
  constructor(message: string) {
    super(`Not a voice pack: ${message}`);
    this.name = "VoicePackFormatError";
  }
}

export interface VoicePackClipInput {
  readonly id: string;
  /** Mono PCM16 at the pack's sample rate. */
  readonly samples: Int16Array;
}

export interface VoicePackClip {
  readonly id: string;
  readonly samples: Int16Array;
}

export interface VoicePack {
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly clips: readonly VoicePackClip[];
}

/** Packs clips into a voice pack file. */
export function encodeVoicePack(
  clips: readonly VoicePackClipInput[],
  sampleRate: number = PET_LIMITS.downSampleRate,
  blockAlign: number = PET_LIMITS.adpcmBlockAlign,
): Uint8Array {
  if (clips.length > 0xffff) {
    throw new RangeError("A voice pack holds at most 65535 clips.");
  }
  const seen = new Set<string>();
  for (const clip of clips) {
    if (!/^[\x21-\x7e]{1,24}$/.test(clip.id)) {
      throw new RangeError(
        `"${clip.id}" is not a clip id: 1 to ${VOICE_PACK_ID_BYTES} printable ASCII characters.`,
      );
    }
    if (seen.has(clip.id)) {
      throw new RangeError(`The clip id "${clip.id}" is used twice.`);
    }
    seen.add(clip.id);
  }
  const encoded = clips.map((clip) => encodeImaAdpcm(clip.samples, blockAlign));
  const tableEnd =
    VOICE_PACK_HEADER_BYTES + VOICE_PACK_ENTRY_BYTES * clips.length;
  const total = encoded.reduce((sum, bytes) => sum + bytes.length, tableEnd);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i += 1) {
    out[i] = VOICE_PACK_MAGIC.charCodeAt(i);
  }
  view.setUint16(4, VOICE_PACK_VERSION, true);
  view.setUint16(6, clips.length, true);
  view.setUint32(8, sampleRate, true);
  view.setUint16(12, blockAlign, true);
  view.setUint16(14, 0, true);
  let offset = tableEnd;
  clips.forEach((clip, i) => {
    const bytes = encoded[i] ?? new Uint8Array(0);
    const entry = VOICE_PACK_HEADER_BYTES + VOICE_PACK_ENTRY_BYTES * i;
    for (let c = 0; c < clip.id.length; c += 1) {
      out[entry + c] = clip.id.charCodeAt(c);
    }
    view.setUint32(entry + 24, offset, true);
    view.setUint32(entry + 28, bytes.length, true);
    view.setUint32(entry + 32, clip.samples.length, true);
    out.set(bytes, offset);
    offset += bytes.length;
  });
  return out;
}

/** Reads a voice pack back to samples, for tests and the simulator. */
export function decodeVoicePack(bytes: Uint8Array): VoicePack {
  const bad = (message: string): VoicePackFormatError =>
    new VoicePackFormatError(message);
  if (bytes.length < VOICE_PACK_HEADER_BYTES) {
    throw bad("it is too short.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(
    bytes[0] ?? 0,
    bytes[1] ?? 0,
    bytes[2] ?? 0,
    bytes[3] ?? 0,
  );
  if (magic !== VOICE_PACK_MAGIC) {
    throw bad("the magic is wrong.");
  }
  if (view.getUint16(4, true) !== VOICE_PACK_VERSION) {
    throw bad("the version is not 1.");
  }
  const count = view.getUint16(6, true);
  const sampleRate = view.getUint32(8, true);
  const blockAlign = view.getUint16(12, true);
  const tableEnd = VOICE_PACK_HEADER_BYTES + VOICE_PACK_ENTRY_BYTES * count;
  if (tableEnd > bytes.length) {
    throw bad("the clip table runs past the end.");
  }
  const clips: VoicePackClip[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = VOICE_PACK_HEADER_BYTES + VOICE_PACK_ENTRY_BYTES * i;
    let id = "";
    for (let c = 0; c < VOICE_PACK_ID_BYTES; c += 1) {
      const code = bytes[entry + c] ?? 0;
      if (code === 0) {
        break;
      }
      id += String.fromCharCode(code);
    }
    const offset = view.getUint32(entry + 24, true);
    const length = view.getUint32(entry + 28, true);
    const samples = view.getUint32(entry + 32, true);
    if (offset < tableEnd || offset + length > bytes.length) {
      throw bad(`the clip "${id}" lies outside the file.`);
    }
    clips.push({
      id,
      samples: decodeImaAdpcm(
        bytes.subarray(offset, offset + length),
        blockAlign,
        samples,
      ),
    });
  }
  return { sampleRate, blockAlign, clips };
}
