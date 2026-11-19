import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { PetVoiceId } from "../../shared/pets/kinds";
import { PET_LIMITS } from "../../shared/pets/limits";
import { PET_LINES } from "../../shared/pets/lines";
import { encodeVoicePack } from "../../shared/pets/voice-pack";
import { sha256Hex } from "./digest";
import {
  ELEVENLABS_VOICES,
  STT_MODEL,
  TTS_MODEL,
  type VoiceClient,
  VoiceError,
  type VoiceFailure,
} from "./voice";

/**
 * A voice pack is the pet's own lines (`lines.ts`) said in one voice and
 * packed for it to keep, so it can speak with no network. No audio of ours is
 * published: the clips are made here, on the owner's own ElevenLabs key, the
 * first time a pet asks for its voice, and kept as a file in the app's data
 * folder (mode 0600). They are fixed sentences with no secret in them. The
 * file's name holds a fingerprint of the lines and the voice, so a changed
 * line or voice is made again and the older file is removed.
 */

export type PackAnswer =
  | { readonly kind: "ready"; readonly bytes: Buffer }
  | { readonly kind: "rendering" }
  | { readonly kind: "no-key" }
  | { readonly kind: "failed"; readonly failure: VoiceFailure };

export interface VoicePacksDeps {
  /** The app's folder for the packs. */
  readonly dir: string;
  readonly voice: VoiceClient;
  readonly hasKey: () => Promise<boolean>;
  readonly now: () => number;
  /** Told how each render ended: a failure, or null when it worked. */
  readonly report: (failure: VoiceFailure | null) => void;
}

/** How long after a failed render another is not tried. */
const RETRY_AFTER_MS = 60_000;

export class VoicePacks {
  private readonly rendering = new Set<PetVoiceId>();
  private readonly failedAt = new Map<
    PetVoiceId,
    { at: number; failure: VoiceFailure }
  >();
  /** Renders run one after another, so a pack never takes both of the key's slots. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: VoicePacksDeps) {}

  /** What names a pack's content: the lines, the voice and the models. */
  static fingerprint(voice: PetVoiceId): string {
    return sha256Hex(
      [
        voice,
        ELEVENLABS_VOICES[voice],
        TTS_MODEL,
        STT_MODEL,
        ...PET_LINES.map((line) => `${line.id}=${line.text}`),
      ].join("\n"),
    ).slice(0, 12);
  }

  private fileOf(voice: PetVoiceId): string {
    return join(
      this.deps.dir,
      `${voice}-${VoicePacks.fingerprint(voice)}.sfvp`,
    );
  }

  /** The pack, or what is being done to make it. Starts a render when needed. */
  async get(voice: PetVoiceId): Promise<PackAnswer> {
    const file = this.fileOf(voice);
    if (existsSync(file)) {
      try {
        return { kind: "ready", bytes: readFileSync(file) };
      } catch {
        // An unreadable file is made again below.
      }
    }
    if (!(await this.deps.hasKey())) return { kind: "no-key" };
    if (this.rendering.has(voice)) return { kind: "rendering" };
    const failed = this.failedAt.get(voice);
    if (failed && this.deps.now() - failed.at < RETRY_AFTER_MS) {
      return { kind: "failed", failure: failed.failure };
    }
    this.ensure(voice);
    return { kind: "rendering" };
  }

  /** Starts making a voice's pack in the background, once. */
  ensure(voice: PetVoiceId): void {
    if (this.rendering.has(voice) || existsSync(this.fileOf(voice))) return;
    this.rendering.add(voice);
    this.failedAt.delete(voice);
    this.chain = this.chain
      .then(() => this.render(voice))
      .catch(() => undefined)
      .finally(() => this.rendering.delete(voice));
  }

  private async render(voice: PetVoiceId): Promise<void> {
    try {
      const clips: { id: string; samples: Int16Array }[] = [];
      for (const line of PET_LINES) {
        const pcm = await this.deps.voice.speak(line.text, voice);
        const samples = new Int16Array(pcm.length >> 1);
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let i = 0; i < samples.length; i += 1) {
          samples[i] = view.getInt16(i * 2, true);
        }
        clips.push({ id: line.id, samples });
      }
      const bytes = encodeVoicePack(clips, PET_LIMITS.downSampleRate);
      mkdirSync(this.deps.dir, { recursive: true });
      const file = this.fileOf(voice);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, bytes, { mode: 0o600 });
      try {
        chmodSync(temp, 0o600);
      } catch {
        // Windows has no modes to set.
      }
      renameSync(temp, file);
      this.removeOlder(voice, file);
      this.deps.report(null);
    } catch (error) {
      const failure =
        error instanceof VoiceError ? error.failure : "unavailable";
      this.failedAt.set(voice, { at: this.deps.now(), failure });
      this.deps.report(failure);
    }
  }

  private removeOlder(voice: PetVoiceId, keep: string): void {
    try {
      for (const name of readdirSync(this.deps.dir)) {
        const path = join(this.deps.dir, name);
        if (path !== keep && name.startsWith(`${voice}-`)) {
          rmSync(path, { force: true });
        }
      }
    } catch {
      // A leftover file does no harm.
    }
  }

  /** Whether a voice's pack is already made. */
  has(voice: PetVoiceId): boolean {
    return existsSync(this.fileOf(voice));
  }

  /** Resolves when the renders started so far are over (for tests and quitting). */
  idle(): Promise<unknown> {
    return this.chain;
  }
}
