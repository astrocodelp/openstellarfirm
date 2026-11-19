/**
 * Every number the pet protocol depends on, in one object. The server, the
 * simulator and the firmware all read these: `header.ts` writes each one into
 * the firmware's `protocol.h` as `PET_<UPPER_SNAKE>`, so a limit is changed
 * here and nowhere else.
 */
export const PET_LIMITS = {
  /**
   * The longest recording. The pet starts listening on a hold of the lime
   * light and keeps going while the owner talks, so this is the ceiling, not the
   * usual length.
   */
  recordMaxSeconds: 120,
  /**
   * The largest upload of one turn: 1 MiB. 120 s of 16 kHz IMA-ADPCM is about
   * 0.97 MB (966,716 bytes with the header), so a full recording fits; a PCM16
   * upload (the simulator's, a test's) holds only about 32 s.
   */
  uploadMaxBytes: 1_048_576,
  /**
   * The pet stops listening after this many seconds without speech: after the
   * owner has talked, or at the start when nothing louder than the room's noise
   * was heard (that recording is dropped, not sent).
   */
  silenceEndSeconds: 5,
  /** Audio up: mono at this rate. */
  upSampleRate: 16_000,
  /** Audio down: raw PCM16 mono at this rate. */
  downSampleRate: 22_050,
  /** IMA-ADPCM block size in bytes (1017 samples per block). */
  adpcmBlockAlign: 512,
  /** How long a turn waits for the main assistant's first answer. */
  firstAnswerWaitSeconds: 25,
  spokenLineMaxChars: 300,
  spokenLineMaxSentences: 2,
  workTitleMaxWords: 6,
  /** Offline notes the pet keeps before it says its memory is full. */
  savedNotesMax: 50,
  turnsPerMinute: 10,
  /** The owner may set a lower `dailyCap`, 1 to this number. */
  turnsPerDay: 200,
  /** Pairing requests a minute for one hashed address. */
  pairPerMinute: 10,
  setupCodeTtlSeconds: 1800,
  pairRequestTtlSeconds: 600,
  confirmMaxWrongTries: 5,
  inboxWaitMaxSeconds: 20,
  inboxTtlSeconds: 86_400,
  /** Oldest notices are dropped first beyond this. */
  inboxMaxNotices: 50,
  heartbeatSeconds: 300,
  /** Settings shows a pet as online when it was seen within this. */
  onlineWindowSeconds: 600,
  turnClaimTtlSeconds: 604_800,
  nameMaxChars: 40,
} as const;

export type PetLimitName = keyof typeof PET_LIMITS;
