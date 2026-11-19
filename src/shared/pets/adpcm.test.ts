import { describe, expect, it } from "vitest";
import {
  decodeImaAdpcm,
  encodeImaAdpcm,
  IMA_INDEX_TABLE,
  IMA_STEP_TABLE,
  imaAdpcmWav,
  parseWav,
  pcm16Wav,
  samplesPerBlock,
  WavFormatError,
  wavDurationSeconds,
  wavToPcm16,
} from "./adpcm";
import { ADPCM_VECTOR_SAMPLES, adpcmVector, adpcmVectorInput } from "./header";

function sine(
  count: number,
  hz: number,
  rate: number,
  amp: number,
): Int16Array {
  return Int16Array.from({ length: count }, (_, i) =>
    Math.round(amp * Math.sin((2 * Math.PI * hz * i) / rate)),
  );
}

function snrDb(original: Int16Array, decoded: Int16Array): number {
  let signal = 0;
  let noise = 0;
  for (let i = 0; i < original.length; i += 1) {
    const a = original[i] ?? 0;
    const e = a - (decoded[i] ?? 0);
    signal += a * a;
    noise += e * e;
  }
  return 10 * Math.log10(signal / Math.max(noise, 1));
}

/**
 * A second, plainly written reference of the IMA algorithm, to hold the
 * package's against: it works a sample at a time on a nibble list.
 */
function referenceDecode(blocks: Uint8Array, blockAlign: number): number[] {
  const out: number[] = [];
  for (let base = 0; base + 4 <= blocks.length; base += blockAlign) {
    let predictor = (blocks[base] ?? 0) | ((blocks[base + 1] ?? 0) << 8);
    if (predictor >= 0x8000) {
      predictor -= 0x10000;
    }
    let index = blocks[base + 2] ?? 0;
    out.push(predictor);
    const nibbles: number[] = [];
    for (
      let at = base + 4;
      at < Math.min(base + blockAlign, blocks.length);
      at += 1
    ) {
      nibbles.push((blocks[at] ?? 0) & 0x0f, (blocks[at] ?? 0) >> 4);
    }
    for (const code of nibbles) {
      const step = IMA_STEP_TABLE[index] ?? 0;
      let diff = step >> 3;
      if (code & 4) diff += step;
      if (code & 2) diff += step >> 1;
      if (code & 1) diff += step >> 2;
      predictor += code & 8 ? -diff : diff;
      predictor = Math.max(-32768, Math.min(32767, predictor));
      index = Math.max(0, Math.min(88, index + (IMA_INDEX_TABLE[code] ?? 0)));
      out.push(predictor);
    }
  }
  return out;
}

/** The step index a block ends on, for the carried index of the next. */
function referenceEndIndex(block: Uint8Array): number {
  let index = block[2] ?? 0;
  for (let at = 4; at < block.length; at += 1) {
    for (const code of [(block[at] ?? 0) & 15, (block[at] ?? 0) >> 4]) {
      index = Math.max(0, Math.min(88, index + (IMA_INDEX_TABLE[code] ?? 0)));
    }
  }
  return index;
}

/**
 * The plain reference encoder: the greedy three-bit search of the IMA
 * reference code, with the block layout of the contract, returning the bytes
 * and the samples a decoder will hear.
 */
function referenceEncode(
  samples: Int16Array,
  blockAlign: number,
): { bytes: Uint8Array; heard: number[] } {
  const perBlock = (blockAlign - 4) * 2 + 1;
  const bytes = new Uint8Array(
    Math.ceil(samples.length / perBlock) * blockAlign,
  );
  const heard: number[] = [];
  let index = 0;
  for (
    let first = 0, block = 0;
    first < samples.length;
    first += perBlock, block += 1
  ) {
    const base = block * blockAlign;
    let predictor = samples[first] ?? 0;
    bytes[base] = predictor & 0xff;
    bytes[base + 1] = (predictor >> 8) & 0xff;
    bytes[base + 2] = index;
    heard.push(predictor);
    const codes: number[] = [];
    for (
      let i = first + 1;
      i < Math.min(first + perBlock, samples.length);
      i += 1
    ) {
      let diff = (samples[i] ?? 0) - predictor;
      let code = 0;
      if (diff < 0) {
        code = 8;
        diff = -diff;
      }
      let step = IMA_STEP_TABLE[index] ?? 0;
      let change = step >> 3;
      for (const bit of [4, 2, 1]) {
        if (diff >= step) {
          code |= bit;
          diff -= step;
          change += step;
        }
        step >>= 1;
      }
      predictor = Math.max(
        -32768,
        Math.min(32767, predictor + (code & 8 ? -change : change)),
      );
      index = Math.max(0, Math.min(88, index + (IMA_INDEX_TABLE[code] ?? 0)));
      codes.push(code);
      heard.push(predictor);
    }
    codes.forEach((code, n) => {
      const at = base + 4 + (n >> 1);
      bytes[at] = (bytes[at] ?? 0) | (n % 2 === 0 ? code : code << 4);
    });
  }
  return { bytes, heard };
}

describe("the IMA tables", () => {
  it("has the 89 standard step sizes", () => {
    expect(IMA_STEP_TABLE).toHaveLength(89);
    expect(IMA_STEP_TABLE[0]).toBe(7);
    expect(IMA_STEP_TABLE[88]).toBe(32_767);
    for (let i = 1; i < IMA_STEP_TABLE.length; i += 1) {
      const step = IMA_STEP_TABLE[i] ?? 0;
      const before = IMA_STEP_TABLE[i - 1] ?? 0;
      expect(step, `step ${i}`).toBeGreaterThan(before);
      expect(step / before, `ratio ${i}`).toBeLessThan(1.25);
    }
    // A few well-known entries of the standard table.
    expect(IMA_STEP_TABLE[8]).toBe(16);
    expect(IMA_STEP_TABLE[16]).toBe(34);
    expect(IMA_STEP_TABLE[40]).toBe(337);
    expect(IMA_STEP_TABLE[43]).toBe(449);
    expect(IMA_STEP_TABLE[64]).toBe(3327);
  });

  it("has the standard index table, which ignores the sign bit", () => {
    expect([...IMA_INDEX_TABLE]).toEqual([
      -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
    ]);
  });
});

describe("samplesPerBlock", () => {
  it("gives 1017 for a 512-byte block", () => {
    expect(samplesPerBlock(512)).toBe(1017);
    expect(samplesPerBlock(256)).toBe(505);
    expect(samplesPerBlock(1024)).toBe(2041);
  });

  it("refuses a block that is not usable", () => {
    for (const bad of [0, 4, 7, 512.5, -512, 100_000, Number.NaN]) {
      expect(() => samplesPerBlock(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe("decoding", () => {
  it("decodes a block worked out by hand", () => {
    // Header: predictor 100, step index 0. Codes: 0, 7, then 15, 8.
    //   code 0 at step 7:  change 0, predictor 100, index 0 (a floor)
    //   code 7 at step 7:  change 0+7+3+1 = 11, predictor 111, index 8
    //   code 15 at step 16: change 2+16+8+4 = 30 down, predictor 81, index 16
    //   code 8 at step 34: change 4 down, predictor 77, index 15
    const block = new Uint8Array(512);
    block.set([100, 0, 0, 0, 0x70, 0x8f]);
    expect([...decodeImaAdpcm(block, 512, 5)]).toEqual([100, 100, 111, 81, 77]);
  });

  it("holds the predictor at the ends of the 16-bit range", () => {
    const up = new Uint8Array(512);
    up.set([0xff, 0x7f, 88, 0]); // 32767, index 88
    up.fill(0x77, 4); // code 7 over and over: always up
    expect(new Set(decodeImaAdpcm(up, 512, 1017))).toEqual(new Set([32_767]));
    const down = new Uint8Array(512);
    down.set([0x00, 0x80, 88, 0]); // -32768
    down.fill(0xff, 4); // code 15: always down
    expect(new Set(decodeImaAdpcm(down, 512, 1017))).toEqual(
      new Set([-32_768]),
    );
  });

  it("keeps the step index inside 0 to 88", () => {
    const block = new Uint8Array(512);
    block.set([0, 0, 0, 0]);
    block.fill(0x00, 4); // code 0 lowers the index; it must stay at 0
    const quiet = decodeImaAdpcm(block, 512, 1017);
    expect(new Set(quiet)).toEqual(new Set([0]));
  });

  it("rejects a step index above 88", () => {
    const block = new Uint8Array(512);
    block[2] = 89;
    try {
      decodeImaAdpcm(block, 512);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WavFormatError);
      expect((error as WavFormatError).code).toBe("bad_ima");
    }
  });

  it("returns every sample of every block without a sample count", () => {
    const data = new Uint8Array(1024);
    expect(decodeImaAdpcm(data, 512)).toHaveLength(2 * 1017);
    expect(decodeImaAdpcm(data, 512, 1500)).toHaveLength(1500);
    expect(decodeImaAdpcm(data, 512, 5)).toHaveLength(5);
    expect(decodeImaAdpcm(data, 512, 0)).toHaveLength(0);
  });

  it("decodes a short last block as far as the data goes", () => {
    const encoded = encodeImaAdpcm(sine(1017 + 20, 300, 16_000, 5000));
    const cut = encoded.subarray(0, 512 + 4 + 10); // 10 data bytes: 20 codes
    expect(decodeImaAdpcm(cut, 512)).toHaveLength(1017 + 1 + 20);
    expect(decodeImaAdpcm(new Uint8Array(3), 512)).toHaveLength(0);
    expect(decodeImaAdpcm(new Uint8Array(0), 512)).toHaveLength(0);
  });

  it("agrees with the plain reference on random blocks", () => {
    // A fixed pseudo-random fill covers every code in every state.
    let state = 12345;
    const data = new Uint8Array(512 * 4);
    for (let i = 0; i < data.length; i += 1) {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      data[i] = state >>> 24;
    }
    for (let block = 0; block < 4; block += 1) {
      data[block * 512 + 2] = (block * 29) % 89;
      data[block * 512 + 3] = 0;
    }
    expect([...decodeImaAdpcm(data, 512)]).toEqual(referenceDecode(data, 512));
  });
});

describe("encoding", () => {
  it("makes whole blocks, none for no samples", () => {
    expect(encodeImaAdpcm(new Int16Array(0))).toHaveLength(0);
    expect(encodeImaAdpcm(new Int16Array(1))).toHaveLength(512);
    expect(encodeImaAdpcm(new Int16Array(1017))).toHaveLength(512);
    expect(encodeImaAdpcm(new Int16Array(1018))).toHaveLength(1024);
    expect(encodeImaAdpcm(new Int16Array(16_000 * 60))).toHaveLength(
      Math.ceil((16_000 * 60) / 1017) * 512,
    );
  });

  it("starts each block with its first sample, the carried index and a zero", () => {
    const samples = sine(3000, 200, 16_000, 9000);
    const encoded = encodeImaAdpcm(samples);
    expect(encoded).toHaveLength(3 * 512);
    const view = new DataView(encoded.buffer);
    expect(view.getInt16(0, true)).toBe(samples[0]);
    expect(encoded[2]).toBe(0);
    expect(encoded[3]).toBe(0);
    for (const block of [1, 2]) {
      const base = block * 512;
      expect(view.getInt16(base, true), `block ${block}`).toBe(
        samples[block * 1017],
      );
      expect(encoded[base + 2], `index of block ${block}`).toBe(
        referenceEndIndex(encoded.subarray(base - 512, base)),
      );
      expect(encoded[base + 3]).toBe(0);
    }
  });

  it("packs the earlier code in the low nibble", () => {
    // 0 then a big jump up: the first code is 0, the second has bit 2 set.
    const encoded = encodeImaAdpcm(Int16Array.from([0, 0, 1000]));
    expect(encoded[4]).toBe(0x70);
  });

  it("pads the last block with zero bytes", () => {
    const encoded = encodeImaAdpcm(Int16Array.from([100, 5000, -5000]));
    expect(encoded).toHaveLength(512);
    // Header (4) + two codes in one byte; everything after is zero.
    expect([...encoded.subarray(5)].every((b) => b === 0)).toBe(true);
    expect(encoded[4]).not.toBe(0);
  });

  it("clamps the 16-bit extremes without wrapping", () => {
    const loud = Int16Array.from({ length: 400 }, (_, i) =>
      i % 2 ? 32_767 : -32_768,
    );
    const decoded = decodeImaAdpcm(encodeImaAdpcm(loud), 512, loud.length);
    expect(decoded[0]).toBe(-32_768);
    // After a few steps the step size has grown to follow the jumps.
    expect(Math.abs((decoded[399] ?? 0) - (loud[399] ?? 0))).toBeLessThan(
      20_000,
    );
    for (const sample of decoded) {
      expect(sample).toBeGreaterThanOrEqual(-32_768);
      expect(sample).toBeLessThanOrEqual(32_767);
    }
  });

  it("keeps the first sample of every block exact", () => {
    const samples = sine(5000, 523, 16_000, 11_000);
    const decoded = decodeImaAdpcm(
      encodeImaAdpcm(samples),
      512,
      samples.length,
    );
    for (let i = 0; i < samples.length; i += 1017) {
      expect(decoded[i]).toBe(samples[i]);
    }
  });

  it("matches the plain reference encoder on noise, with all its extremes", () => {
    let state = 99;
    const noise = Int16Array.from({ length: 4000 }, () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return (state >>> 16) - 32_768;
    });
    const ref = referenceEncode(noise, 512);
    expect([...encodeImaAdpcm(noise)]).toEqual([...ref.bytes]);
    expect([...decodeImaAdpcm(ref.bytes, 512, noise.length)]).toEqual(
      ref.heard.slice(0, noise.length),
    );
  });

  it("follows a sine within a small error", () => {
    const samples = sine(16_000, 440, 16_000, 12_000);
    const decoded = decodeImaAdpcm(
      encodeImaAdpcm(samples),
      512,
      samples.length,
    );
    expect(decoded).toHaveLength(samples.length);
    expect(snrDb(samples, decoded)).toBeGreaterThan(30);
    let worst = 0;
    for (let i = 100; i < samples.length; i += 1) {
      worst = Math.max(worst, Math.abs((samples[i] ?? 0) - (decoded[i] ?? 0)));
    }
    expect(worst).toBeLessThan(600);
  });

  it("follows a quiet signal too", () => {
    const samples = sine(16_000, 300, 16_000, 400);
    const decoded = decodeImaAdpcm(
      encodeImaAdpcm(samples),
      512,
      samples.length,
    );
    expect(snrDb(samples, decoded)).toBeGreaterThan(20);
  });

  it("works with another block size", () => {
    const samples = sine(4000, 440, 16_000, 12_000);
    const encoded = encodeImaAdpcm(samples, 256);
    expect(encoded.length % 256).toBe(0);
    const decoded = decodeImaAdpcm(encoded, 256, samples.length);
    expect(snrDb(samples, decoded)).toBeGreaterThan(25);
  });
});

describe("the test vector", () => {
  it("computes its input in integer math", () => {
    expect(adpcmVectorInput(0)).toBe(-13_000);
    // n = 25: ((25 * 97) % 4001) - 2000 = 425, * 8 = 3400, n % 50 >= 25: -3000
    expect(adpcmVectorInput(25)).toBe(400);
    for (let n = 0; n < ADPCM_VECTOR_SAMPLES; n += 1) {
      const value = adpcmVectorInput(n);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(-32_768);
      expect(value).toBeLessThanOrEqual(32_767);
    }
  });

  it("is three blocks long, the last one short", () => {
    const { input, encoded, decoded } = adpcmVector();
    expect(input).toHaveLength(2100);
    expect(encoded).toHaveLength(3 * 512);
    expect(decoded).toHaveLength(2100);
  });

  it("decodes exactly as the plain reference does", () => {
    const { encoded, decoded } = adpcmVector();
    expect([...decoded]).toEqual(referenceDecode(encoded, 512).slice(0, 2100));
  });

  it("encodes as the plain reference encoder does, byte for byte", () => {
    const { input, encoded } = adpcmVector();
    expect([...encoded]).toEqual([...referenceEncode(input, 512).bytes]);
  });

  it("is reconstructed by the decoder exactly as the encoder tracked it", () => {
    const { input, decoded } = adpcmVector();
    expect([...decoded]).toEqual(
      referenceEncode(input, 512).heard.slice(0, 2100),
    );
    // The first sample of every block is the input's, exactly.
    for (const block of [0, 1, 2]) {
      expect(decoded[block * 1017]).toBe(input[block * 1017]);
    }
  });

  it("carries the step index from one block to the next", () => {
    const { encoded } = adpcmVector();
    for (const block of [1, 2]) {
      expect(encoded[block * 512 + 2]).toBe(
        referenceEndIndex(encoded.subarray((block - 1) * 512, block * 512)),
      );
    }
    expect(encoded[2]).toBe(0);
  });

  it("is the same every time", () => {
    expect([...adpcmVector().encoded]).toEqual([...adpcmVector().encoded]);
  });
});

describe("writing WAV files", () => {
  const samples = sine(2500, 440, 16_000, 9000);

  it("writes a 44-byte PCM16 header and the samples", () => {
    const wav = pcm16Wav(samples, 16_000);
    expect(wav).toHaveLength(44 + 5000);
    const text = (at: number) =>
      String.fromCharCode(...wav.subarray(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(text(36)).toBe("data");
    const view = new DataView(wav.buffer);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(5000);
  });

  it("writes an IMA WAV with the fields of the contract", () => {
    const wav = imaAdpcmWav(samples, 16_000);
    const view = new DataView(wav.buffer);
    const text = (at: number) =>
      String.fromCharCode(...wav.subarray(at, at + 4));
    expect(text(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(20);
    expect(view.getUint16(20, true)).toBe(0x11);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(Math.floor((16_000 * 512) / 1017));
    expect(view.getUint16(32, true)).toBe(512);
    expect(view.getUint16(34, true)).toBe(4);
    expect(view.getUint16(36, true)).toBe(2);
    expect(view.getUint16(38, true)).toBe(1017);
    expect(text(40)).toBe("fact");
    expect(view.getUint32(44, true)).toBe(4);
    expect(view.getUint32(48, true)).toBe(2500);
    expect(text(52)).toBe("data");
    expect(view.getUint32(56, true)).toBe(3 * 512);
    expect(wav).toHaveLength(60 + 3 * 512);
  });
});

describe("reading WAV files", () => {
  const samples = sine(2500, 440, 16_000, 9000);

  it("reads back a PCM16 file exactly", () => {
    const parsed = parseWav(pcm16Wav(samples, 16_000));
    expect(parsed).toMatchObject({
      format: "pcm16",
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      blockAlign: 2,
      sampleCount: 2500,
    });
    expect(parsed.data).toHaveLength(5000);
    expect(wavDurationSeconds(parsed)).toBeCloseTo(2500 / 16_000, 6);
    const back = wavToPcm16(pcm16Wav(samples, 16_000));
    expect(back.sampleRate).toBe(16_000);
    expect([...back.samples]).toEqual([...samples]);
  });

  it("reads back an IMA file, with the real sample count from fact", () => {
    const wav = imaAdpcmWav(samples, 16_000);
    const parsed = parseWav(wav);
    expect(parsed).toMatchObject({
      format: "ima-adpcm",
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 4,
      blockAlign: 512,
      sampleCount: 2500,
    });
    expect(parsed.data).toHaveLength(3 * 512);
    expect(wavDurationSeconds(parsed)).toBeCloseTo(2500 / 16_000, 6);
    const decoded = wavToPcm16(wav);
    expect(decoded.samples).toHaveLength(2500);
    expect(snrDb(samples, decoded.samples)).toBeGreaterThan(25);
  });

  it("reads an IMA file with no fact chunk as whole blocks", () => {
    const wav = imaAdpcmWav(samples, 16_000);
    // Rename the fact chunk so it is skipped.
    const noFact = wav.slice();
    noFact.set(new TextEncoder().encode("junk"), 40);
    expect(parseWav(noFact).sampleCount).toBe(3 * 1017);
  });

  it("skips chunks it does not know, even odd-sized ones", () => {
    const wav = pcm16Wav(samples.subarray(0, 100), 16_000);
    const list = new Uint8Array(8 + 5 + 1);
    list.set(new TextEncoder().encode("LIST"), 0);
    new DataView(list.buffer).setUint32(4, 5, true);
    // 5 bytes of body and a pad byte.
    const out = new Uint8Array(36 + list.length + (wav.length - 36));
    out.set(wav.subarray(0, 36), 0);
    out.set(list, 36);
    out.set(wav.subarray(36), 36 + list.length);
    const parsed = parseWav(out);
    expect(parsed.sampleCount).toBe(100);
    expect(wavToPcm16(out).samples[50]).toBe(samples[50]);
  });

  it("reads the data of a view into a larger buffer", () => {
    const wav = pcm16Wav(samples.subarray(0, 64), 16_000);
    const padded = new Uint8Array(wav.length + 10);
    padded.set(wav, 7);
    expect([...wavToPcm16(padded.subarray(7, 7 + wav.length)).samples]).toEqual(
      [...samples.subarray(0, 64)],
    );
  });

  it("reads other sample rates, which the server checks for itself", () => {
    expect(parseWav(pcm16Wav(samples, 22_050)).sampleRate).toBe(22_050);
  });
});

describe("refusing a file it does not read", () => {
  function code(bytes: Uint8Array): string {
    try {
      parseWav(bytes);
    } catch (error) {
      expect(error).toBeInstanceOf(WavFormatError);
      return (error as WavFormatError).code;
    }
    return "accepted";
  }

  const good = pcm16Wav(sine(200, 440, 16_000, 5000), 16_000);
  const edit = (
    patch: (view: DataView, bytes: Uint8Array) => void,
  ): Uint8Array => {
    const copy = good.slice();
    patch(new DataView(copy.buffer), copy);
    return copy;
  };

  it("refuses what is not RIFF or not WAVE", () => {
    expect(code(new Uint8Array(0))).toBe("not_riff");
    expect(code(new Uint8Array(11))).toBe("not_riff");
    expect(
      code(new TextEncoder().encode("ID3\u0004 not a wave file at all")),
    ).toBe("not_riff");
    expect(
      code(edit((_, b) => b.set(new TextEncoder().encode("AVI "), 8))),
    ).toBe("not_wave");
  });

  it("refuses a chunk that runs past the end", () => {
    expect(code(good.subarray(0, good.length - 1))).toBe("truncated");
    expect(code(good.subarray(0, 30))).toBe("truncated");
  });

  it("refuses a file with no fmt or no data chunk", () => {
    expect(code(good.subarray(0, 12))).toBe("no_fmt");
    expect(
      code(edit((_, b) => b.set(new TextEncoder().encode("junk"), 12))),
    ).toBe("no_fmt");
    expect(
      code(edit((_, b) => b.set(new TextEncoder().encode("junk"), 36))),
    ).toBe("no_data");
  });

  it("refuses a fmt chunk that is too short", () => {
    expect(code(edit((v) => v.setUint32(16, 14, true)))).toBe("bad_fmt");
  });

  it("refuses stereo", () => {
    expect(code(edit((v) => v.setUint16(22, 2, true)))).toBe("unsupported");
  });

  it("refuses 8-bit and 24-bit PCM", () => {
    expect(code(edit((v) => v.setUint16(34, 8, true)))).toBe("unsupported");
    expect(code(edit((v) => v.setUint16(34, 24, true)))).toBe("unsupported");
  });

  it("refuses a format tag other than PCM and IMA", () => {
    for (const tag of [3, 6, 7, 0x55, 0xfffe]) {
      expect(code(edit((v) => v.setUint16(20, tag, true))), String(tag)).toBe(
        "unsupported",
      );
    }
  });

  it("refuses an unusable sample rate", () => {
    expect(code(edit((v) => v.setUint32(24, 0, true)))).toBe("bad_fmt");
    expect(code(edit((v) => v.setUint32(24, 500_000, true)))).toBe("bad_fmt");
  });

  it("refuses PCM data cut mid-sample", () => {
    const odd = edit((v) => v.setUint32(40, 399, true));
    expect(code(odd)).toBe("bad_fmt");
  });

  it("refuses IMA that is not 4-bit, 512 bytes and 1017 samples", () => {
    const ima = imaAdpcmWav(sine(2000, 440, 16_000, 5000), 16_000);
    const change = (patch: (view: DataView) => void): Uint8Array => {
      const copy = ima.slice();
      patch(new DataView(copy.buffer));
      return copy;
    };
    expect(code(ima)).toBe("accepted");
    expect(code(change((v) => v.setUint16(34, 8, true)))).toBe("bad_ima");
    expect(code(change((v) => v.setUint16(32, 256, true)))).toBe("bad_ima");
    expect(code(change((v) => v.setUint16(38, 505, true)))).toBe("bad_ima");
    expect(code(change((v) => v.setUint16(36, 0, true)))).toBe("bad_ima");
  });

  it("refuses IMA data that is not whole blocks, and a fact that counts too much", () => {
    const ima = imaAdpcmWav(sine(2000, 440, 16_000, 5000), 16_000);
    const shortData = ima.slice();
    new DataView(shortData.buffer).setUint32(56, 600, true);
    expect(code(shortData.subarray(0, 60 + 600))).toBe("bad_ima");
    const bigFact = ima.slice();
    new DataView(bigFact.buffer).setUint32(48, 2 * 1017 + 1, true);
    expect(code(bigFact)).toBe("bad_ima");
  });
});
