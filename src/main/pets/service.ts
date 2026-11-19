import { randomBytes as nodeRandomBytes, X509Certificate } from "node:crypto";
import type { Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import type {
  DeskPetConfig,
  DeskPetConfirm,
  DeskPetSetupCode,
  DeskPetsStatus,
} from "../../shared/desk-pets";
import { isPetVoiceId } from "../../shared/pets/kinds";
import { PET_LIMITS } from "../../shared/pets/limits";
import { petHelloLine } from "../../shared/pets/lines";
import { type NoticeKind, parsePetName } from "../../shared/pets/protocol";
import { type InterfaceMap, privateInterfaceAddresses } from "./address";
import { type BackendDeps, PetBackend, type PetTurnHost } from "./backend";
import {
  type DeskPetCertificate,
  fingerprintOfPem,
  type MakeCertificateInput,
  makeCertificate,
} from "./cert";
import { PetInbox } from "./inbox";
import { MdnsResponder, mdnsNameOf } from "./mdns";
import { VoicePacks } from "./packs";
import { Pairing } from "./pairing";
import { DEFAULT_PORT, PetServer } from "./server";
import { PetStore } from "./store";
import { ElevenLabsClient, type VoiceClient, type VoiceFailure } from "./voice";

/**
 * Desk pets, as the main process sees them: the switch, the certificate, the
 * server, the mDNS answer and the list of pets. Nothing here is built until
 * the first call, and nothing listens until the owner turns Desk pets on.
 */

/** The part of `Secrets` this needs; tests hand in a plain map. */
export interface PetSecrets {
  available(): Promise<boolean>;
  get(id: string): Promise<string | undefined>;
  set(id: string, value: string): Promise<void>;
  remove(id: string): void;
}

export interface PetServiceDeps {
  /** The JSON file for the saved state, in the app's data folder. */
  readonly file: string;
  readonly secrets: PetSecrets;
  readonly now?: () => number;
  readonly randomBytes?: (count: number) => Uint8Array;
  readonly interfaces?: () => InterfaceMap;
  /** Tests listen on loopback with port 0 and a fixed address check. */
  readonly host?: string;
  readonly defaultPort?: number;
  readonly allowAddress?: (address: string | undefined) => boolean;
  readonly createSocket?: (type: "udp4" | "udp6") => Socket;
  readonly makeCertificate?: (
    input: MakeCertificateInput,
  ) => DeskPetCertificate;
  /** Who a pet's turns go to. Without it a turn answers that it cannot. */
  readonly turns?: PetTurnHost;
  /** Speech. The default is ElevenLabs on the saved key; tests hand in a stub. */
  readonly voice?: VoiceClient;
  /** Where the voice packs are kept; the data folder's `desk-pet-voice`. */
  readonly packDir?: string;
  readonly firstAnswerWaitMs?: BackendDeps["firstAnswerWaitMs"];
}

export const KEY_SECRET = "desk-pets:key";
export const CERT_SECRET = "desk-pets:cert";
/** The owner's own ElevenLabs key. Sent only to api.elevenlabs.io. */
export const VOICE_SECRET = "desk-pets:elevenlabs";

const VOICE_PROBLEMS: Readonly<Record<string, string>> = {
  "key-missing":
    "Your desk pets need your ElevenLabs key to talk. Add it in Settings.",
  "key-refused":
    "ElevenLabs refused your key, so your desk pets cannot talk. Check the key in Settings.",
  quota:
    "Your ElevenLabs quota is used up, so your desk pets cannot talk until it is back.",
};

/** A key looks like one word of printable characters; anything else is not sent. */
const KEY_SHAPE = /^[\x21-\x7e]{8,512}$/;

export const NO_KEYCHAIN_MESSAGE =
  "Desk pets keep their certificate in your system's keychain, and this computer has no keychain that keeps secrets private, so they were not turned on.";

export class PetService {
  private readonly store: PetStore;
  private readonly pairing: Pairing;
  private readonly now: () => number;
  private readonly randomBytes: (count: number) => Uint8Array;
  private server: PetServer | null = null;
  private mdns: MdnsResponder | null = null;
  private problem: string | null = null;
  private voiceProblem: string | null = null;
  private readonly inbox: PetInbox;
  private readonly packs: VoicePacks;
  private readonly backend: PetBackend;
  /** Changes of the switch run one after another. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: PetServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.randomBytes = deps.randomBytes ?? ((n) => nodeRandomBytes(n));
    this.store = new PetStore(deps.file, this.randomBytes);
    this.pairing = new Pairing({
      store: this.store,
      now: this.now,
      randomBytes: this.randomBytes,
      approveUrl: () =>
        `https://${mdnsNameOf(this.store.state.label)}:${this.store.state.port ?? DEFAULT_PORT}/`,
    });
    const voice =
      deps.voice ??
      new ElevenLabsClient({
        getKey: () => deps.secrets.get(VOICE_SECRET).catch(() => undefined),
      });
    const report = (failure: VoiceFailure | null) => {
      this.voiceProblem =
        failure === null
          ? null
          : (VOICE_PROBLEMS[failure] ?? this.voiceProblem);
    };
    this.inbox = new PetInbox(this.now);
    this.packs = new VoicePacks({
      dir: deps.packDir ?? join(dirname(deps.file), "desk-pet-voice"),
      voice,
      hasKey: () => this.hasVoiceKey(),
      now: this.now,
      report,
    });
    this.backend = new PetBackend({
      store: this.store,
      voice,
      packs: this.packs,
      inbox: this.inbox,
      host: () => deps.turns,
      now: this.now,
      report,
      ...(deps.firstAnswerWaitMs !== undefined
        ? { firstAnswerWaitMs: deps.firstAnswerWaitMs }
        : {}),
    });
  }

  private async hasVoiceKey(): Promise<boolean> {
    try {
      return (await this.deps.secrets.get(VOICE_SECRET)) !== undefined;
    } catch {
      return false;
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private addresses(): string[] {
    return privateInterfaceAddresses(
      (this.deps.interfaces ?? (() => networkInterfaces() as InterfaceMap))(),
    );
  }

  private async stored(): Promise<DeskPetCertificate | null> {
    const keyPem = await this.deps.secrets.get(KEY_SECRET);
    const certPem = await this.deps.secrets.get(CERT_SECRET);
    if (!keyPem || !certPem) return null;
    try {
      new X509Certificate(certPem);
    } catch {
      return null;
    }
    return { keyPem, certPem, fingerprint: fingerprintOfPem(certPem) };
  }

  private async makeAndKeep(): Promise<DeskPetCertificate> {
    const make = this.deps.makeCertificate ?? makeCertificate;
    const made = make({
      now: new Date(this.now()),
      randomBytes: this.randomBytes,
      dnsName: mdnsNameOf(this.store.state.label),
      ips: this.addresses(),
    });
    await this.deps.secrets.set(KEY_SECRET, made.keyPem);
    try {
      await this.deps.secrets.set(CERT_SECRET, made.certPem);
    } catch (error) {
      this.deps.secrets.remove(KEY_SECRET);
      throw error;
    }
    return made;
  }

  // -- Switch ----------------------------------------------------------------

  /** Starts the server and the name answer from the saved certificate. */
  private async startAll(cert: DeskPetCertificate): Promise<void> {
    const server = new PetServer({
      store: this.store,
      pairing: this.pairing,
      keyPem: cert.keyPem,
      certPem: cert.certPem,
      now: this.now,
      allowAddress: this.deps.allowAddress,
      backend: this.backend,
      onPaired: (petId) => this.welcome(petId),
    });
    const port = await server.start({
      host: this.deps.host,
      port: this.store.state.port ?? this.deps.defaultPort ?? DEFAULT_PORT,
    });
    this.server = server;
    this.store.change((state) => {
      state.port = port;
    });
    this.problem = null;
    const mdns = new MdnsResponder({
      label: this.store.state.label,
      addresses: () => this.addresses(),
      createSocket: this.deps.createSocket,
    });
    try {
      await mdns.start();
      this.mdns = mdns;
    } catch {
      mdns.stop();
      this.problem =
        "Desk pets are on, but this computer would not let the app answer its network name. A pet finds the computer by its saved address until that works.";
    }
  }

  private async stopAll(): Promise<void> {
    this.mdns?.stop();
    this.mdns = null;
    const server = this.server;
    this.server = null;
    await server?.stop();
  }

  turnOn(): Promise<DeskPetsStatus> {
    return this.serial(async () => {
      if (this.server) return this.status();
      if (!(await this.deps.secrets.available())) {
        throw new Error(NO_KEYCHAIN_MESSAGE);
      }
      const cert = (await this.stored()) ?? (await this.makeAndKeep());
      try {
        await this.startAll(cert);
      } catch {
        await this.stopAll();
        throw new Error(
          "The app could not open its port for desk pets. Close what is using it, or try again.",
        );
      }
      this.store.change((state) => {
        state.enabled = true;
      });
      return this.status();
    });
  }

  turnOff(): Promise<DeskPetsStatus> {
    return this.serial(async () => {
      await this.stopAll();
      this.problem = null;
      this.store.change((state) => {
        state.enabled = false;
        // A half-made pairing does not wait for the next time.
        state.setup = [];
        state.requests = state.requests.filter((r) => r.state === "approved");
      });
      return this.status();
    });
  }

  /**
   * Starts again at launch when the owner left Desk pets on. A failure leaves
   * the switch as it was and says why in the status.
   */
  resume(): Promise<void> {
    return this.serial(async () => {
      if (!this.store.state.enabled || this.server) return;
      try {
        if (!(await this.deps.secrets.available())) {
          this.problem = NO_KEYCHAIN_MESSAGE;
          return;
        }
        const cert = await this.stored();
        if (!cert) {
          this.problem =
            "The desk pet certificate is missing from the keychain. Make a new certificate and pair your pets again.";
          return;
        }
        await this.startAll(cert);
      } catch {
        await this.stopAll();
        this.problem = "The app could not open its port for desk pets.";
      }
    });
  }

  /** A new certificate. Every pet's pin is now wrong, so every pet is forgotten. */
  newCertificate(): Promise<DeskPetsStatus> {
    return this.serial(async () => {
      if (!(await this.deps.secrets.available())) {
        throw new Error(NO_KEYCHAIN_MESSAGE);
      }
      const wasRunning = this.server !== null;
      await this.stopAll();
      const cert = await this.makeAndKeep();
      this.store.change((state) => {
        state.pets = [];
        state.setup = [];
        state.requests = [];
      });
      if (wasRunning || this.store.state.enabled) {
        try {
          await this.startAll(cert);
        } catch {
          await this.stopAll();
          this.problem =
            "The app made a new certificate but could not open its port for desk pets.";
        }
      }
      return this.status();
    });
  }

  async shutdown(): Promise<void> {
    await this.serial(() => this.stopAll());
    await this.packs.idle().catch(() => undefined);
  }

  // -- Pairing and the list --------------------------------------------------

  async startAdding(): Promise<DeskPetSetupCode> {
    if (!this.server) throw new Error("Turn Desk pets on before adding a pet.");
    return this.pairing.startAdding();
  }

  async confirm(code: string): Promise<DeskPetConfirm> {
    return this.pairing.confirm(String(code));
  }

  async forget(id: string): Promise<DeskPetsStatus> {
    this.store.change((state) => {
      state.pets = state.pets.filter((pet) => pet.id !== id);
      state.drafts = state.drafts.filter((draft) => draft.petId !== id);
    });
    this.inbox.forget(id);
    return this.status();
  }

  // -- Voice, turns and notices ----------------------------------------------

  /** A new pet's hello, and its voice pack made in the background. */
  private welcome(petId: string): void {
    const pet = this.store.state.pets.find((p) => p.id === petId);
    if (!pet) return;
    this.inbox.push(pet.id, {
      kind: "message",
      line: petHelloLine(pet.name),
    });
    void this.hasVoiceKey().then((has) => {
      if (has) this.packs.ensure(pet.settings.voice);
      else this.voiceProblem = VOICE_PROBLEMS["key-missing"] ?? null;
    });
  }

  /**
   * Saves the owner's ElevenLabs key in the keychain. It is never read back to
   * the page; the status says only that one is set.
   */
  async setVoiceKey(key: string): Promise<DeskPetsStatus> {
    const trimmed = String(key).trim();
    if (!KEY_SHAPE.test(trimmed)) {
      throw new Error("That does not look like an ElevenLabs key.");
    }
    await this.deps.secrets.set(VOICE_SECRET, trimmed);
    this.voiceProblem = null;
    for (const pet of this.store.state.pets)
      this.packs.ensure(pet.settings.voice);
    return this.status();
  }

  async clearVoiceKey(): Promise<DeskPetsStatus> {
    this.deps.secrets.remove(VOICE_SECRET);
    this.voiceProblem = null;
    return this.status();
  }

  /** The assistant a pet talks to, its voice and whether it speaks answers. */
  async setConfig(id: string, change: DeskPetConfig): Promise<DeskPetsStatus> {
    const pet = this.store.state.pets.find((p) => p.id === id);
    if (!pet) throw new Error("That pet is not paired any more.");
    if (change.voice !== undefined && !isPetVoiceId(change.voice)) {
      throw new Error("That voice is not one of the pets' voices.");
    }
    if (change.assistantId !== undefined && change.assistantId !== null) {
      const target =
        typeof change.assistantId === "string"
          ? this.deps.turns?.target(change.assistantId)
          : null;
      if (!target || target.id !== change.assistantId) {
        throw new Error("That assistant is not here.");
      }
    }
    this.store.change(() => {
      if (change.assistantId !== undefined) {
        pet.config = { ...pet.config, assistantId: change.assistantId };
      }
      if (typeof change.speakAnswers === "boolean") {
        pet.config = { ...pet.config, speakAnswers: change.speakAnswers };
      }
      if (change.voice !== undefined) {
        pet.settings = { ...pet.settings, voice: change.voice };
      }
    });
    if (change.voice !== undefined && (await this.hasVoiceKey())) {
      this.packs.ensure(change.voice);
    }
    return this.status();
  }

  async discardDraft(id: string): Promise<DeskPetsStatus> {
    this.store.change((state) => {
      state.drafts = state.drafts.filter((draft) => draft.id !== id);
    });
    return this.status();
  }

  /**
   * Tells every paired pet that something happened: the work is done, it
   * stopped, a step waits (the pet hears only that, never which step) or a
   * check has an update. Nothing is queued while Desk pets are off.
   */
  notify(
    kind: Extract<NoticeKind, "done" | "approval" | "stopped" | "message">,
    info: {
      role?: string | null;
      title?: string | null;
      chat?: string;
      run?: string;
    } = {},
  ): void {
    if (!this.server) return;
    try {
      this.backend.notify(kind, info);
    } catch {
      // A notice that could not be made never stops the work it is about.
    }
  }

  async rename(id: string, name: string): Promise<DeskPetsStatus> {
    const parsed = parsePetName(name);
    if (!parsed.ok) {
      throw new Error(
        "A pet's name is letters, spaces, apostrophes and hyphens.",
      );
    }
    const pet = this.store.state.pets.find((p) => p.id === id);
    if (!pet) throw new Error("That pet is not paired any more.");
    const renamed = { ...pet, name: parsed.value };
    this.store.change((state) => {
      state.pets = state.pets.map((p) => (p.id === id ? renamed : p));
    });
    return this.status();
  }

  async status(): Promise<DeskPetsStatus> {
    this.pairing.sweep();
    const state = this.store.state;
    const now = this.now();
    const cert = await this.stored().catch(() => null);
    return {
      enabled: state.enabled,
      running: this.server?.listening === true,
      port: state.port,
      mdnsName: mdnsNameOf(state.label),
      mdnsRunning: this.mdns?.listening === true,
      fingerprint: cert?.fingerprint ?? null,
      pets: state.pets.map((pet) => ({
        id: pet.id,
        name: pet.name,
        kind: pet.kind,
        pairedAt: pet.pairedAt,
        lastSeenAt: pet.lastSeenAt,
        online:
          pet.lastSeenAt !== null &&
          now - Date.parse(pet.lastSeenAt) <=
            PET_LIMITS.onlineWindowSeconds * 1000,
        firmware: pet.firmware,
        battery: pet.battery,
        charging: pet.charging,
        voice: pet.settings.voice,
        assistantId: pet.config.assistantId,
        speakAnswers: pet.config.speakAnswers,
      })),
      drafts: state.drafts.map((draft) => ({
        id: draft.id,
        petId: draft.petId,
        assistantId: draft.assistantId,
        text: draft.text,
        at: draft.at,
      })),
      voiceKey: await this.hasVoiceKey(),
      voiceProblem: this.voiceProblem,
      pending: this.pairing.pending(),
      setupExpiresAt: this.pairing.setupExpiresAt(),
      problem: this.problem,
    };
  }

  /** Whether the saved file says Desk pets are on, without building anything. */
  static savedOn(file: string): boolean {
    return PetStore.savedOn(file);
  }
}
