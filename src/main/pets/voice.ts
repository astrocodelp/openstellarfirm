import type { PetVoiceId } from "../../shared/pets/kinds";

/**
 * Speech for desk pets, on the owner's own ElevenLabs key.
 *
 * The key is read through `getKey` for each call, goes only in the
 * `xi-api-key` header of a request to one hard-coded origin, and is never
 * logged, put in an error or returned. A redirect is never followed (it
 * would carry the key somewhere else), every call has a deadline and every
 * answer a size cap. Nothing here keeps audio.
 *
 * What this assumes of ElevenLabs' API (written from its public reference, not
 * run against the live service here):
 *  - `POST /v1/speech-to-text`, multipart with `model_id` and `file`, answers
 *    JSON with a `text`.
 *  - `POST /v1/text-to-speech/{voice_id}?output_format=pcm_22050`, JSON with
 *    `text` and `model_id`, answers raw PCM16 little-endian mono at 22.05 kHz.
 *  - A refused key is 401 or 403, a used-up quota is 401 with
 *    `detail.status` `quota_exceeded` (or 429), and 429 is also what too many
 *    calls at once answer (`too_many_concurrent_requests`).
 */

export const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";
export const STT_MODEL = "scribe_v1";
export const TTS_MODEL = "eleven_flash_v2_5";

/**
 * The six pet voices as ElevenLabs premade voice ids. These are well known
 * premade voices; the owner can change them here later (a premade voice may be
 * retired by ElevenLabs, and then a call answers a 404 and the pet says it
 * cannot speak right now).
 */
export const ELEVENLABS_VOICES: Readonly<Record<PetVoiceId, string>> = {
  talia: "21m00Tcm4TlvDq8ikWAM", // Rachel
  alicia: "EXAVITQu4vr4xnSDxMaL", // Bella
  maisie: "MF3mGyEYCl7XYWbV9V6O", // Elli
  darian: "TxGEqnHWrfWFTfGW9XjX", // Josh
  eldrin: "pNInz6obpgDQGcFmaJgB", // Adam
  wyatt: "ErXwobaYiN019PkySvjV", // Antoni
};

export type VoiceFailure =
  | "key-missing"
  | "key-refused"
  | "quota"
  | "busy"
  | "unavailable";

/** Why a spoken call did not work, with no text of the answer in it. */
export class VoiceError extends Error {
  constructor(readonly failure: VoiceFailure) {
    super(`Speech failed: ${failure}.`);
    this.name = "VoiceError";
  }
}

export interface VoiceClient {
  /** The words in a mono PCM16 WAV file, or "" when none were heard. */
  transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string>;
  /** Raw PCM16 little-endian mono at 22.05 kHz. */
  speak(
    text: string,
    voice: PetVoiceId,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

/** Runs at most `max` jobs at once; the rest wait in order. */
export class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await job();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const STT_TIMEOUT_MS = 60_000;
const TTS_TIMEOUT_MS = 30_000;
const STT_ANSWER_MAX_BYTES = 256 * 1024;
const TTS_AUDIO_MAX_BYTES = 6 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 4096;
const SPEECH_MAX_CHARS = 600;
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;

export interface ElevenLabsOptions {
  /** The saved key, or undefined when there is none. Read for every call. */
  readonly getKey: () => Promise<string | undefined>;
  readonly fetch?: typeof fetch;
  readonly sttTimeoutMs?: number;
  readonly ttsTimeoutMs?: number;
  /** Calls at once; the free plan allows two. */
  readonly concurrency?: number;
}

/** Reads a body up to `max` bytes; null when it is longer. */
async function readCapped(
  response: Response,
  max: number,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export class ElevenLabsClient implements VoiceClient {
  private readonly gate: Gate;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: ElevenLabsOptions) {
    this.gate = new Gate(options.concurrency ?? 2);
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** One call: the key header, no redirect, a deadline, and the failure mapping. */
  private async call(
    path: string,
    init: { body: BodyInit; headers?: Record<string, string> },
    timeoutMs: number,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const key = (await this.options.getKey())?.trim();
    if (!key) throw new VoiceError("key-missing");
    return this.gate.run(async () => {
      const deadline = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await this.doFetch(`${ELEVENLABS_ORIGIN}${path}`, {
          method: "POST",
          body: init.body,
          redirect: "manual",
          headers: { ...init.headers, "xi-api-key": key },
          signal: signal ? AbortSignal.any([deadline, signal]) : deadline,
        });
      } catch {
        throw new VoiceError("unavailable");
      }
      try {
        // A redirect is never followed: its address is never read.
        if (
          response.type === "opaqueredirect" ||
          (response.status >= 300 && response.status < 400)
        ) {
          throw new VoiceError("unavailable");
        }
        if (!response.ok) {
          const body = await readCapped(response, ERROR_BODY_MAX_BYTES).catch(
            () => null,
          );
          throw new VoiceError(
            failureOf(
              response.status,
              body ? Buffer.from(body).toString("utf8") : "",
            ),
          );
        }
        const bytes = await readCapped(response, maxBytes).catch(() => null);
        if (!bytes) throw new VoiceError("unavailable");
        return bytes;
      } finally {
        // An unread body must not hold the connection.
        void response.body?.cancel().catch(() => undefined);
      }
    });
  }

  async transcribe(wav: Uint8Array, signal?: AbortSignal): Promise<string> {
    const form = new FormData();
    form.append("model_id", STT_MODEL);
    form.append("tag_audio_events", "false");
    form.append(
      "file",
      new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
      "note.wav",
    );
    const bytes = await this.call(
      "/v1/speech-to-text",
      { body: form },
      this.options.sttTimeoutMs ?? STT_TIMEOUT_MS,
      STT_ANSWER_MAX_BYTES,
      signal,
    );
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
        text?: unknown;
      };
      if (typeof parsed.text !== "string") throw new Error("no text");
      return parsed.text.trim();
    } catch {
      throw new VoiceError("unavailable");
    }
  }

  async speak(
    text: string,
    voice: PetVoiceId,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const id = ELEVENLABS_VOICES[voice];
    if (!id || !VOICE_ID.test(id)) throw new VoiceError("unavailable");
    const spoken = text.trim().slice(0, SPEECH_MAX_CHARS);
    if (!spoken) throw new VoiceError("unavailable");
    const bytes = await this.call(
      `/v1/text-to-speech/${id}?output_format=pcm_22050`,
      {
        body: JSON.stringify({ text: spoken, model_id: TTS_MODEL }),
        headers: { "Content-Type": "application/json" },
      },
      this.options.ttsTimeoutMs ?? TTS_TIMEOUT_MS,
      TTS_AUDIO_MAX_BYTES,
      signal,
    );
    // Whole 16-bit samples only.
    return bytes.length % 2 === 0 ? bytes : bytes.subarray(0, bytes.length - 1);
  }
}

/**
 * What a refused call means. ElevenLabs answers 401 for a used-up quota too,
 * so the body's `detail.status` is read before a 401 is taken as a bad key.
 */
export function failureOf(status: number, body: string): VoiceFailure {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as {
      detail?: { status?: unknown } | string;
    };
    const d = parsed.detail;
    detail = typeof d === "string" ? d : String(d?.status ?? "");
  } catch {
    // An answer that is not JSON is judged by its status alone.
  }
  if (/quota/i.test(detail)) return "quota";
  if (status === 401 || status === 403) return "key-refused";
  if (status === 429) return /concurrent/i.test(detail) ? "busy" : "quota";
  return "unavailable";
}
