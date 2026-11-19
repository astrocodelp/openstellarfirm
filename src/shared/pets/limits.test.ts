import { describe, expect, it } from "vitest";
import { imaAdpcmWav, pcm16Wav, samplesPerBlock } from "./adpcm";
import { PET_LIMITS } from "./limits";

describe("PET_LIMITS", () => {
  it("holds the numbers of the contract", () => {
    expect(PET_LIMITS).toEqual({
      recordMaxSeconds: 120,
      uploadMaxBytes: 1_048_576,
      silenceEndSeconds: 5,
      upSampleRate: 16_000,
      downSampleRate: 22_050,
      adpcmBlockAlign: 512,
      firstAnswerWaitSeconds: 25,
      spokenLineMaxChars: 300,
      spokenLineMaxSentences: 2,
      workTitleMaxWords: 6,
      savedNotesMax: 50,
      turnsPerMinute: 10,
      turnsPerDay: 200,
      pairPerMinute: 10,
      setupCodeTtlSeconds: 1800,
      pairRequestTtlSeconds: 600,
      confirmMaxWrongTries: 5,
      inboxWaitMaxSeconds: 20,
      inboxTtlSeconds: 86_400,
      inboxMaxNotices: 50,
      heartbeatSeconds: 300,
      onlineWindowSeconds: 600,
      turnClaimTtlSeconds: 604_800,
      nameMaxChars: 40,
    });
  });

  it("is the listening rule: up to two minutes, five seconds of silence", () => {
    expect(PET_LIMITS.recordMaxSeconds).toBe(2 * 60);
    expect(PET_LIMITS.silenceEndSeconds).toBe(5);
    // The upload cap is 1 MiB, written as a number of MiB so a typo shows.
    expect(PET_LIMITS.uploadMaxBytes).toBe(1024 * 1024);
  });

  it("keeps the longest recording, as ADPCM and with its header, inside the upload limit", () => {
    const samples = PET_LIMITS.recordMaxSeconds * PET_LIMITS.upSampleRate;
    const blocks = Math.ceil(
      samples / samplesPerBlock(PET_LIMITS.adpcmBlockAlign),
    );
    // 1888 blocks of 512 bytes and the 60-byte IMA header: about 0.97 MB.
    expect(blocks).toBe(1888);
    const wav = imaAdpcmWav(
      new Int16Array(samples),
      PET_LIMITS.upSampleRate,
      PET_LIMITS.adpcmBlockAlign,
    );
    expect(wav).toHaveLength(60 + blocks * PET_LIMITS.adpcmBlockAlign);
    expect(wav.length).toBe(966_716);
    expect(wav.length).toBeLessThan(PET_LIMITS.uploadMaxBytes);
    // And it leaves room (about 80 KB), so the cap is not the edge.
    expect(PET_LIMITS.uploadMaxBytes - wav.length).toBeGreaterThan(75_000);
  });

  it("keeps one more second of ADPCM under the byte cap, so the duration check is what refuses 121 s", () => {
    // The server reads the length from the WAV: 121 s is 974,908 bytes, which the
    // body cap alone would let through.
    const samples = (PET_LIMITS.recordMaxSeconds + 1) * PET_LIMITS.upSampleRate;
    const wav = imaAdpcmWav(
      new Int16Array(samples),
      PET_LIMITS.upSampleRate,
      PET_LIMITS.adpcmBlockAlign,
    );
    expect(wav.length).toBe(974_908);
    expect(wav.length).toBeLessThan(PET_LIMITS.uploadMaxBytes);
  });

  it("holds only about 32 seconds as PCM16, which is why the pet uploads ADPCM", () => {
    const pcmSeconds =
      (PET_LIMITS.uploadMaxBytes - 44) / (PET_LIMITS.upSampleRate * 2);
    expect(Math.floor(pcmSeconds)).toBe(32);
    expect(pcmSeconds).toBeLessThan(PET_LIMITS.recordMaxSeconds / 3);
    // The same figures through the real writer: 32 s fits, 33 s does not.
    const fits = pcm16Wav(
      new Int16Array(32 * PET_LIMITS.upSampleRate),
      PET_LIMITS.upSampleRate,
    );
    expect(fits.length).toBeLessThanOrEqual(PET_LIMITS.uploadMaxBytes);
    const tooBig = pcm16Wav(
      new Int16Array(33 * PET_LIMITS.upSampleRate),
      PET_LIMITS.upSampleRate,
    );
    expect(tooBig.length).toBeGreaterThan(PET_LIMITS.uploadMaxBytes);
  });

  it("is four times bigger as PCM16 than as ADPCM, which is why the pet encodes as the microphone delivers", () => {
    // The pet keeps the recording as ADPCM in a slot of its 8 MB PSRAM. As PCM16
    // the same 120 s would be 3.84 MB; two slots of that take 7.68 MB, nearly all
    // of the PSRAM, with nothing left for the secure connection and the answer.
    const pcmBytes = PET_LIMITS.recordMaxSeconds * PET_LIMITS.upSampleRate * 2;
    expect(pcmBytes).toBe(3_840_000);
    expect(2 * pcmBytes).toBeGreaterThan(7 * 1024 * 1024);
    expect(pcmBytes / PET_LIMITS.uploadMaxBytes).toBeGreaterThan(3.5);
  });
});
