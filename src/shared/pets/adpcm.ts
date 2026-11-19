import { PET_LIMITS } from "./limits";

/** The standard IMA step sizes. */
export const IMA_STEP_TABLE: readonly number[] = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
  50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
  1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
  3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
  11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
  32767,
];

/** How the step index moves after a 4-bit code (only the low three bits count). */
export const IMA_INDEX_TABLE: readonly number[] = [
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
];

const MAX_INDEX = IMA_STEP_TABLE.length - 1;
const HEADER_BYTES = 4;
/** Smallest block that holds a header and a few codes. */
const MIN_BLOCK_ALIGN = 8;
const MAX_BLOCK_ALIGN = 8192;

export type WavFormatErrorCode =
  | "not_riff"
  | "not_wave"
  | "truncated"
  | "no_fmt"
  | "no_data"
  | "bad_fmt"
  | "unsupported"
  | "bad_ima";

/** A file that is not a WAV the pet protocol reads. The server answers 415. */
export class WavFormatError extends Error {
  readonly code: WavFormatErrorCode;

  constructor(code: WavFormatErrorCode, message: string) {
    super(message);
    this.name = "WavFormatError";
    this.code = code;
  }
}

function checkBlockAlign(blockAlign: number): void {
  if (
    !Number.isInteger(blockAlign) ||
    blockAlign < MIN_BLOCK_ALIGN ||
    blockAlign > MAX_BLOCK_ALIGN
  ) {
    throw new RangeError(
      `An IMA-ADPCM block of ${blockAlign} bytes is not supported.`,
    );
  }
}

/** Samples in one block: the header's own sample, then two per data byte. */
export function samplesPerBlock(blockAlign: number): number {
  checkBlockAlign(blockAlign);
  return (blockAlign - HEADER_BYTES) * 2 + 1;
}

function clamp16(value: number): number {
  return Math.min(32767, Math.max(-32768, value));
}

function clampIndex(value: number): number {
  return Math.min(MAX_INDEX, Math.max(0, value));
}

/** The step size at an index the caller has already kept in range. */
function stepAt(index: number): number {
  return IMA_STEP_TABLE[index] ?? 7;
}

/**
 * Encodes mono samples as IMA-ADPCM blocks. Each block starts with a 4-byte
 * header (the block's first sample as a little-endian int16 predictor, the
 * step index, a zero byte) followed by 4-bit codes, low nibble first. The
 * step index carries on from one block to the next; the predictor restarts at
 * each block's first sample. The last block is padded with zero bytes, so the
 * caller keeps the sample count (a WAV's `fact` chunk) to know where the real
 * samples end. The firmware's encoder is bit-identical.
 */
export function encodeImaAdpcm(
  samples: Int16Array,
  blockAlign: number = PET_LIMITS.adpcmBlockAlign,
): Uint8Array {
  const perBlock = samplesPerBlock(blockAlign);
  const blocks = Math.ceil(samples.length / perBlock);
  const out = new Uint8Array(blocks * blockAlign);
  const view = new DataView(out.buffer);
  let index = 0;
  for (let block = 0; block < blocks; block += 1) {
    const base = block * blockAlign;
    const first = block * perBlock;
    let predictor = samples[first] ?? 0;
    view.setInt16(base, predictor, true);
    out[base + 2] = index;
    out[base + 3] = 0;
    const end = Math.min(first + perBlock, samples.length);
    for (let i = first + 1; i < end; i += 1) {
      const sample = samples[i] ?? 0;
      let step = stepAt(index);
      let diff = sample - predictor;
      let code = 0;
      if (diff < 0) {
        code = 8;
        diff = -diff;
      }
      let delta = step >> 3;
      if (diff >= step) {
        code |= 4;
        diff -= step;
        delta += step;
      }
      step >>= 1;
      if (diff >= step) {
        code |= 2;
        diff -= step;
        delta += step;
      }
      step >>= 1;
      if (diff >= step) {
        code |= 1;
        delta += step;
      }
      predictor = clamp16(code & 8 ? predictor - delta : predictor + delta);
      index = clampIndex(index + (IMA_INDEX_TABLE[code] ?? 0));
      // Codes are packed two to a byte, the earlier one in the low nibble.
      const n = i - first - 1;
      const at = base + HEADER_BYTES + (n >> 1);
      out[at] = (out[at] ?? 0) | (n % 2 === 0 ? code : code << 4);
    }
  }
  return out;
}

/**
 * Decodes IMA-ADPCM blocks to samples. `sampleCount` says how many are real
 * (the padding of the last block is left out); without it every sample of
 * every whole or partial block is returned. Throws `WavFormatError` for a
 * block whose step index is out of range.
 */
export function decodeImaAdpcm(
  data: Uint8Array,
  blockAlign: number = PET_LIMITS.adpcmBlockAlign,
  sampleCount?: number,
): Int16Array {
  const perBlock = samplesPerBlock(blockAlign);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Int16Array(Math.ceil(data.length / blockAlign) * perBlock);
  let written = 0;
  const limit = sampleCount ?? out.length;
  for (
    let base = 0;
    base + HEADER_BYTES <= data.length && written < limit;
    base += blockAlign
  ) {
    let predictor = view.getInt16(base, true);
    let index = data[base + 2] ?? 0;
    if (index > MAX_INDEX) {
      throw new WavFormatError(
        "bad_ima",
        "An IMA-ADPCM block has a step index above 88.",
      );
    }
    out[written] = predictor;
    written += 1;
    const end = Math.min(base + blockAlign, data.length);
    for (let at = base + HEADER_BYTES; at < end; at += 1) {
      const byte = data[at] ?? 0;
      for (const code of [byte & 15, byte >> 4]) {
        const step = stepAt(index);
        let delta = step >> 3;
        if (code & 4) {
          delta += step;
        }
        if (code & 2) {
          delta += step >> 1;
        }
        if (code & 1) {
          delta += step >> 2;
        }
        predictor = clamp16(code & 8 ? predictor - delta : predictor + delta);
        index = clampIndex(index + (IMA_INDEX_TABLE[code] ?? 0));
        out[written] = predictor;
        written += 1;
      }
    }
  }
  // A copy, so a short clip does not keep the whole working buffer alive.
  return out.slice(0, Math.min(written, limit));
}

// -- WAV files ---------------------------------------------------------------

const FORMAT_PCM = 1;
const FORMAT_IMA = 0x11;

/** What `parseWav` found in a file the pet protocol reads. */
export interface ParsedWav {
  readonly format: "pcm16" | "ima-adpcm";
  readonly sampleRate: number;
  readonly channels: 1;
  readonly bitsPerSample: 16 | 4;
  readonly blockAlign: number;
  /** Real samples: the `fact` count for IMA-ADPCM, else what the data holds. */
  readonly sampleCount: number;
  /** The `data` chunk's bytes, as a view into the file. */
  readonly data: Uint8Array;
}

function fourCc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/**
 * Reads a RIFF/WAVE file the pet protocol accepts: mono, either PCM16 (format
 * tag 1) or IMA-ADPCM (format tag 0x11, 4 bits, a 512-byte block of 1017
 * samples). Chunks are walked, so extra chunks such as `LIST` are skipped.
 * The sample rate is returned, not checked: the server wants 16 kHz from a
 * pet, the simulator reads the 22.05 kHz answers it writes. Anything else
 * throws `WavFormatError`.
 */
export function parseWav(bytes: Uint8Array): ParsedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || fourCc(view, 0) !== "RIFF") {
    throw new WavFormatError("not_riff", "This is not a RIFF file.");
  }
  if (fourCc(view, 8) !== "WAVE") {
    throw new WavFormatError("not_wave", "This is not a WAVE file.");
  }
  let fmt:
    | {
        tag: number;
        channels: number;
        sampleRate: number;
        blockAlign: number;
        bits: number;
        extra: number;
        perBlock: number;
      }
    | undefined;
  let factSamples: number | undefined;
  let data: Uint8Array | undefined;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = fourCc(view, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (body + size > bytes.length) {
      throw new WavFormatError(
        "truncated",
        `The "${id}" chunk runs past the end of the file.`,
      );
    }
    if (id === "fmt ") {
      if (size < 16) {
        throw new WavFormatError("bad_fmt", "The fmt chunk is too short.");
      }
      fmt = {
        tag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bits: view.getUint16(body + 14, true),
        extra: size >= 18 ? view.getUint16(body + 16, true) : 0,
        perBlock: size >= 20 ? view.getUint16(body + 18, true) : 0,
      };
    } else if (id === "fact" && size >= 4) {
      factSamples = view.getUint32(body, true);
    } else if (id === "data") {
      data = bytes.subarray(body, body + size);
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }
  if (!fmt) {
    throw new WavFormatError("no_fmt", "The file has no fmt chunk.");
  }
  if (!data) {
    throw new WavFormatError("no_data", "The file has no data chunk.");
  }
  if (fmt.channels !== 1) {
    throw new WavFormatError("unsupported", "Only mono audio is accepted.");
  }
  if (fmt.sampleRate < 1000 || fmt.sampleRate > 192_000) {
    throw new WavFormatError("bad_fmt", "The sample rate is not usable.");
  }
  if (fmt.tag === FORMAT_PCM) {
    if (fmt.bits !== 16 || fmt.blockAlign !== 2) {
      throw new WavFormatError("unsupported", "Only 16-bit PCM is accepted.");
    }
    if (data.length % 2 !== 0) {
      throw new WavFormatError("bad_fmt", "The PCM data is cut mid-sample.");
    }
    return {
      format: "pcm16",
      sampleRate: fmt.sampleRate,
      channels: 1,
      bitsPerSample: 16,
      blockAlign: 2,
      sampleCount: data.length / 2,
      data,
    };
  }
  if (fmt.tag === FORMAT_IMA) {
    const blockAlign = PET_LIMITS.adpcmBlockAlign;
    const perBlock = samplesPerBlock(blockAlign);
    if (
      fmt.bits !== 4 ||
      fmt.blockAlign !== blockAlign ||
      fmt.extra < 2 ||
      fmt.perBlock !== perBlock
    ) {
      throw new WavFormatError(
        "bad_ima",
        `IMA-ADPCM must be 4-bit with ${blockAlign}-byte blocks of ${perBlock} samples.`,
      );
    }
    if (data.length % blockAlign !== 0) {
      throw new WavFormatError("bad_ima", "The data is not whole blocks.");
    }
    const capacity = (data.length / blockAlign) * perBlock;
    if (factSamples !== undefined && factSamples > capacity) {
      throw new WavFormatError(
        "bad_ima",
        "The fact chunk counts more samples than the data holds.",
      );
    }
    return {
      format: "ima-adpcm",
      sampleRate: fmt.sampleRate,
      channels: 1,
      bitsPerSample: 4,
      blockAlign,
      sampleCount: factSamples ?? capacity,
      data,
    };
  }
  throw new WavFormatError(
    "unsupported",
    `WAV format tag ${fmt.tag} is not accepted; send PCM16 or IMA-ADPCM.`,
  );
}

/** The samples of a PCM16 or IMA-ADPCM WAV, decoded to PCM16. */
export function wavToPcm16(bytes: Uint8Array): {
  sampleRate: number;
  samples: Int16Array;
} {
  const wav = parseWav(bytes);
  if (wav.format === "ima-adpcm") {
    return {
      sampleRate: wav.sampleRate,
      samples: decodeImaAdpcm(wav.data, wav.blockAlign, wav.sampleCount),
    };
  }
  const view = new DataView(
    wav.data.buffer,
    wav.data.byteOffset,
    wav.data.byteLength,
  );
  const samples = new Int16Array(wav.sampleCount);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true);
  }
  return { sampleRate: wav.sampleRate, samples };
}

/** How long a parsed WAV plays. */
export function wavDurationSeconds(wav: ParsedWav): number {
  return wav.sampleCount / wav.sampleRate;
}

function writeFourCc(view: DataView, at: number, text: string): void {
  for (let i = 0; i < 4; i += 1) {
    view.setUint8(at + i, text.charCodeAt(i));
  }
}

/** A mono PCM16 WAV file. */
export function pcm16Wav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  writeFourCc(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeFourCc(view, 8, "WAVE");
  writeFourCc(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeFourCc(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  }
  return out;
}

/**
 * A mono IMA-ADPCM WAV file: a `fmt ` chunk (tag 0x11, `cbSize` 2 and the
 * samples per block), a `fact` chunk with the real sample count, and the
 * encoded blocks. This is what a pet uploads.
 */
export function imaAdpcmWav(
  samples: Int16Array,
  sampleRate: number,
  blockAlign: number = PET_LIMITS.adpcmBlockAlign,
): Uint8Array {
  const perBlock = samplesPerBlock(blockAlign);
  const encoded = encodeImaAdpcm(samples, blockAlign);
  const fmtSize = 20;
  const total = 12 + (8 + fmtSize) + (8 + 4) + (8 + encoded.length);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  writeFourCc(view, 0, "RIFF");
  view.setUint32(4, total - 8, true);
  writeFourCc(view, 8, "WAVE");
  writeFourCc(view, 12, "fmt ");
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, FORMAT_IMA, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, Math.floor((sampleRate * blockAlign) / perBlock), true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 4, true);
  view.setUint16(36, 2, true);
  view.setUint16(38, perBlock, true);
  writeFourCc(view, 40, "fact");
  view.setUint32(44, 4, true);
  view.setUint32(48, samples.length, true);
  writeFourCc(view, 52, "data");
  view.setUint32(56, encoded.length, true);
  out.set(encoded, 60);
  return out;
}
