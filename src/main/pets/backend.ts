import { randomUUID } from "node:crypto";
import {
  parseWav,
  pcm16Wav,
  WavFormatError,
  wavToPcm16,
} from "../../shared/pets/adpcm";
import { PET_VOICE_IDS, type PetVoiceId } from "../../shared/pets/kinds";
import { PET_LIMITS } from "../../shared/pets/limits";
import { petLine, petRoleId } from "../../shared/pets/lines";
import {
  isQuietNow,
  type Notice,
  type NoticeKind,
  type PetErrorCode,
  type PetState,
  petError,
} from "../../shared/pets/protocol";
import { spokenAnswer } from "../../shared/pets/spoken";
import { sha256Hex } from "./digest";
import type { PetInbox } from "./inbox";
import type { VoicePacks } from "./packs";
import { MAX_DRAFTS, type PetStore, type StoredPet } from "./store";
import { type VoiceClient, VoiceError, type VoiceFailure } from "./voice";

/**
 * What the pet's turns, spoken notices and voice pack do, with no HTTP in it:
 * the server reads a request, hands it here and writes the reply back.
 *
 * A turn is the owner's own message to one assistant. The app hands it to the
 * `PetTurnHost`, which sends it the way a typed message is sent, so the same
 * approval gate holds. This folder has no way to answer a step that waits for
 * the owner: the host can tell a run that a step waits (`needsYou`), and that
 * is all, and the pet hears only the fixed "needs you" line for it.
 */

export interface PetTarget {
  readonly id: string;
  /** The role's id (`developer`, `scientist`), when the assistant has one. */
  readonly role?: string | undefined;
}

export type PetOutcome =
  | { readonly kind: "answered"; readonly text: string }
  | { readonly kind: "failed" }
  | { readonly kind: "stopped" };

/** One turn's message while it runs. */
export interface PetRun {
  /** The chat the message went to: the assistant's id. */
  readonly chat: string;
  /** The message's own id. */
  readonly run: string;
  /** Resolves when the answer ends, however it ends. Never rejects. */
  readonly outcome: Promise<PetOutcome>;
  /** Resolves when a step of this run waits for the owner. Never rejects. */
  readonly needsYou: Promise<void>;
}

/** What the app lends the pets: whom they talk to and a way to send. */
export interface PetTurnHost {
  /** The assistant a pet's turns go to; null when none exists. */
  target(assistantId: string | null): PetTarget | null;
  busy(assistantId: string): boolean;
  /** Sends the owner's words, marked as from a desk pet. Throws when it cannot. */
  start(assistantId: string, text: string): Promise<PetRun>;
}

export type BackendReply =
  | { readonly kind: "json"; readonly status: number; readonly body: unknown }
  | {
      readonly kind: "audio";
      /** Present on a turn's answer, absent on a notice read aloud. */
      readonly state?: PetState;
      /** What is said, for the `X-Pet-Line` header. */
      readonly line: string;
      readonly chat?: string | undefined;
      readonly run?: string | undefined;
      /** Raw PCM16 little-endian mono at 22.05 kHz; empty when speech failed. */
      readonly pcm: Uint8Array;
    };

export type PackReply =
  | { readonly kind: "file"; readonly bytes: Buffer }
  | { readonly kind: "json"; readonly status: number; readonly body: unknown };

export interface BackendDeps {
  readonly store: PetStore;
  readonly voice: VoiceClient;
  readonly packs: VoicePacks;
  readonly inbox: PetInbox;
  readonly host: () => PetTurnHost | undefined;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** Told what a speech call ended in; null when it worked. */
  readonly report: (failure: VoiceFailure | null) => void;
  /** How long a live turn waits for the first answer. */
  readonly firstAnswerWaitMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SPEECH_SAMPLES = 1600;
const MAX_NOTE_CHARS = 2000;
const AUDIO_CACHE_MAX_BYTES = 8 * 1024 * 1024;
const AUDIO_CACHE_TTL_MS = 10 * 60_000;
const CLAIMS_MAX = 2000;
/** Longest encoded `X-Pet-Line` the pet reads whole (it keeps 1500). */
const LINE_HEADER_MAX = 1400;

const error = (code: PetErrorCode): BackendReply => {
  const { status, body } = petError(code);
  return { kind: "json", status, body };
};

/** A refused, missing or used-up key, or a service that is not answering. */
function voiceFailureReply(failure: VoiceFailure): BackendReply {
  switch (failure) {
    case "key-missing":
    case "key-refused":
      return error("no_access");
    case "quota":
      return error("out_of_credits");
    case "busy":
      return error("too_many");
    case "unavailable":
      return error("voice_off");
  }
}

/** The text cut so its percent-encoded form fits in one header. */
export function lineForHeader(text: string): string {
  let line = text;
  while (line.length > 0 && encodeURIComponent(line).length > LINE_HEADER_MAX) {
    line = line.slice(0, Math.floor(line.length * 0.8));
  }
  return line.trim();
}

/** Fixed sentences and notices, spoken once and kept a few minutes in memory. */
class AudioCache {
  private readonly items = new Map<string, { pcm: Uint8Array; at: number }>();
  private size = 0;

  constructor(private readonly now: () => number) {}

  get(key: string): Uint8Array | undefined {
    const found = this.items.get(key);
    if (!found) return undefined;
    if (this.now() - found.at > AUDIO_CACHE_TTL_MS) {
      this.drop(key);
      return undefined;
    }
    return found.pcm;
  }

  put(key: string, pcm: Uint8Array): void {
    if (pcm.length > AUDIO_CACHE_MAX_BYTES / 4) return;
    this.drop(key);
    this.items.set(key, { pcm, at: this.now() });
    this.size += pcm.length;
    for (const oldest of this.items.keys()) {
      if (this.size <= AUDIO_CACHE_MAX_BYTES) break;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const found = this.items.get(key);
    if (!found) return;
    this.size -= found.pcm.length;
    this.items.delete(key);
  }
}

type Sleep = { promise: Promise<"timeout">; cancel(): void };

function sleep(ms: number): Sleep {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export class PetBackend {
  private readonly claims = new Map<string, number>();
  private readonly audio: AudioCache;

  constructor(private readonly deps: BackendDeps) {
    this.audio = new AudioCache(deps.now);
  }

  // -- Speech ----------------------------------------------------------------

  private async speak(
    text: string,
    voice: PetVoiceId,
    keep: boolean,
  ): Promise<Uint8Array> {
    const key = `${voice}:${sha256Hex(text)}`;
    const cached = keep ? this.audio.get(key) : undefined;
    if (cached) return cached;
    try {
      const pcm = await this.deps.voice.speak(text, voice);
      this.deps.report(null);
      if (keep) this.audio.put(key, pcm);
      return pcm;
    } catch (caught) {
      const failure =
        caught instanceof VoiceError ? caught.failure : "unavailable";
      this.deps.report(failure);
      throw new VoiceError(failure);
    }
  }

  private async transcribe(wav: Uint8Array): Promise<string> {
    try {
      const text = await this.deps.voice.transcribe(wav);
      this.deps.report(null);
      return text;
    } catch (caught) {
      const failure =
        caught instanceof VoiceError ? caught.failure : "unavailable";
      this.deps.report(failure);
      throw new VoiceError(failure);
    }
  }

  // -- Turns -----------------------------------------------------------------

  private claim(petId: string, turnId: string): boolean {
    const at = this.deps.now();
    const ttl = PET_LIMITS.turnClaimTtlSeconds * 1000;
    if (this.claims.size >= CLAIMS_MAX) {
      for (const [key, taken] of this.claims) {
        if (at - taken > ttl) this.claims.delete(key);
      }
      if (this.claims.size >= CLAIMS_MAX) {
        const oldest = this.claims.keys().next().value;
        if (oldest !== undefined) this.claims.delete(oldest);
      }
    }
    const key = `${petId}:${turnId}`;
    const taken = this.claims.get(key);
    if (taken !== undefined && at - taken <= ttl) return false;
    this.claims.set(key, at);
    return true;
  }

  async turn(
    pet: StoredPet,
    input: {
      readonly turnId: string | undefined;
      readonly offline: boolean;
      readonly body: Buffer;
    },
  ): Promise<BackendReply> {
    const turnId = input.turnId?.toLowerCase();
    if (!turnId || !UUID.test(turnId)) return error("bad_request");
    if (input.body.length === 0) return error("bad_audio");
    if (pet.settings.paused) return error("paused");
    if (!this.claim(pet.id, turnId)) {
      return {
        kind: "json",
        status: 208,
        body: { status: "already-received" },
      };
    }
    const release = () => this.claims.delete(`${pet.id}:${turnId}`);

    let wav: Uint8Array;
    try {
      const parsed = parseWav(input.body);
      if (parsed.sampleCount < MIN_SPEECH_SAMPLES) {
        return input.offline
          ? { kind: "json", status: 200, body: { status: "empty" } }
          : error("heard_nothing");
      }
      const decoded = wavToPcm16(input.body);
      // The pet's IMA-ADPCM is decoded here: the speech service gets plain PCM.
      wav = pcm16Wav(decoded.samples, decoded.sampleRate);
    } catch (caught) {
      release();
      if (caught instanceof WavFormatError) return error("bad_audio");
      throw caught;
    }

    let text: string;
    try {
      text = await this.transcribe(wav);
    } catch (caught) {
      release();
      return voiceFailureReply(
        caught instanceof VoiceError ? caught.failure : "unavailable",
      );
    }
    if (!/[\p{L}\p{N}]/u.test(text)) {
      return input.offline
        ? { kind: "json", status: 200, body: { status: "empty" } }
        : error("heard_nothing");
    }
    const words = text.slice(0, MAX_NOTE_CHARS);

    const host = this.deps.host();
    const target = host?.target(pet.config.assistantId) ?? null;
    if (!host || !target) {
      release();
      return error("voice_off");
    }
    if (input.offline) return this.note(pet, host, target, words, release);
    return this.live(pet, host, target, words, release);
  }

  /** A note the pet saved while offline: no audio comes back. */
  private async note(
    pet: StoredPet,
    host: PetTurnHost,
    target: PetTarget,
    text: string,
    release: () => void,
  ): Promise<BackendReply> {
    if (pet.settings.savedNotes === "draft") {
      const draft = {
        id: randomUUID(),
        petId: pet.id,
        assistantId: target.id,
        text,
        at: new Date(this.deps.now()).toISOString(),
      };
      this.deps.store.change((state) => {
        state.drafts = [...state.drafts, draft].slice(-MAX_DRAFTS);
      });
      return {
        kind: "json",
        status: 200,
        body: { status: "draft", chat: target.id },
      };
    }
    if (host.busy(target.id)) {
      release();
      return error("too_many");
    }
    try {
      const run = await host.start(target.id, text);
      return {
        kind: "json",
        status: 200,
        body: { status: "sent", chat: run.chat, run: run.run },
      };
    } catch {
      release();
      return error("too_many");
    }
  }

  /** A turn the owner is waiting on: speech comes back, however it went. */
  private async live(
    pet: StoredPet,
    host: PetTurnHost,
    target: PetTarget,
    text: string,
    release: () => void,
  ): Promise<BackendReply> {
    if (host.busy(target.id)) {
      release();
      return error("too_many");
    }
    let run: PetRun;
    try {
      run = await host.start(target.id, text);
    } catch {
      release();
      return error("too_many");
    }
    const wait = sleep(
      this.deps.firstAnswerWaitMs ?? PET_LIMITS.firstAnswerWaitSeconds * 1000,
    );
    const first = await Promise.race([
      run.outcome,
      run.needsYou.then(() => "needs-you" as const),
      wait.promise,
    ]);
    wait.cancel();

    const said = (
      state: PetState,
      line: string,
      keep: boolean,
    ): Promise<BackendReply> => this.answerAudio(pet, run, state, line, keep);

    if (first === "needs-you") {
      return said("needs-approve", petLine("needs-approve").text, true);
    }
    if (first === "timeout") {
      return said("working", petLine("working").text, true);
    }
    if (first.kind === "answered") {
      const spoken = pet.config.speakAnswers ? spokenAnswer(first.text) : "";
      return spoken
        ? said("answered", spoken, false)
        : said("answered", petLine("done").text, true);
    }
    return said("refused", petLine("stopped").text, true);
  }

  private async answerAudio(
    pet: StoredPet,
    run: PetRun,
    state: PetState,
    line: string,
    keep: boolean,
  ): Promise<BackendReply> {
    const header = lineForHeader(line);
    try {
      const pcm = await this.speak(line, pet.settings.voice, keep);
      return {
        kind: "audio",
        state,
        line: header,
        chat: run.chat,
        run: run.run,
        pcm,
      };
    } catch {
      // The run has started and its work goes on: the pet gets the state and
      // no sound, and the app says why in its status.
      return {
        kind: "audio",
        state,
        line: header,
        chat: run.chat,
        run: run.run,
        pcm: new Uint8Array(0),
      };
    }
  }

  // -- A notice read aloud ---------------------------------------------------

  async say(pet: StoredPet, seq: number): Promise<BackendReply> {
    const notice = this.deps.inbox.get(pet.id, seq);
    if (!notice || notice.line === "") return error("notice_gone");
    try {
      const pcm = await this.speak(notice.line, pet.settings.voice, true);
      return { kind: "audio", line: lineForHeader(notice.line), pcm };
    } catch (caught) {
      return voiceFailureReply(
        caught instanceof VoiceError ? caught.failure : "unavailable",
      );
    }
  }

  // -- The inbox -------------------------------------------------------------

  async inbox(
    pet: StoredPet,
    after: number,
    waitSeconds: number,
    signal: AbortSignal,
  ): Promise<{
    notices: readonly Notice[];
    next: number;
    quiet: boolean;
  }> {
    const read = await this.deps.inbox.wait(pet.id, after, waitSeconds, signal);
    return {
      notices: read.notices,
      next: read.next,
      quiet: isQuietNow(pet.settings.quietHours, new Date(this.deps.now())),
    };
  }

  /** Tells every paired pet something. Never carries a step or an amount. */
  notify(
    kind: Exclude<NoticeKind, "settings" | "budget">,
    info: {
      role?: string | null;
      title?: string | null;
      chat?: string;
      run?: string;
      line?: string;
    } = {},
  ): void {
    const role = petRoleId(info.role);
    for (const pet of this.deps.store.state.pets) {
      this.deps.inbox.push(pet.id, {
        kind,
        role,
        title: info.title,
        chat: info.chat,
        run: info.run,
        line: info.line,
      });
    }
  }

  // -- The voice pack --------------------------------------------------------

  async pack(voice: string): Promise<PackReply> {
    if (!(PET_VOICE_IDS as readonly string[]).includes(voice)) {
      return {
        kind: "json",
        status: 404,
        body: { error: "off", line: "busy" },
      };
    }
    const answer = await this.deps.packs.get(voice as PetVoiceId);
    switch (answer.kind) {
      case "ready":
        return { kind: "file", bytes: answer.bytes };
      case "no-key":
        return {
          kind: "json",
          status: 503,
          body: { error: "voice_off", line: "no-access" },
        };
      case "failed": {
        const reply = voiceFailureReply(answer.failure);
        return reply.kind === "json"
          ? {
              kind: "json",
              status: 503,
              body: reply.body,
            }
          : { kind: "json", status: 503, body: petError("voice_off").body };
      }
      case "rendering":
        return {
          kind: "json",
          status: 503,
          body: petError("voice_off").body,
        };
    }
  }
}
