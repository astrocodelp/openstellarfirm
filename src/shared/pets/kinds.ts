import type { PetSettings } from "./protocol";

/** The three figures a desk pet can be, the same three as the app's pets. */
export const PET_KINDS = ["astronaut", "alien", "cat"] as const;

export type PetKind = (typeof PET_KINDS)[number];

export const DEFAULT_PET_KIND: PetKind = "astronaut";

/**
 * The six voices a pet can speak in. These are the names that go on the wire and
 * in the voice pack file names. The app maps each one to a voice of the owner's
 * own speech service (a later phase of docs/desk-pets-plan.md).
 */
export const PET_VOICE_IDS = [
  "talia",
  "alicia",
  "maisie",
  "darian",
  "eldrin",
  "wyatt",
] as const;

export type PetVoiceId = (typeof PET_VOICE_IDS)[number];

export function isPetVoiceId(value: unknown): value is PetVoiceId {
  return (
    typeof value === "string" &&
    (PET_VOICE_IDS as readonly string[]).includes(value)
  );
}

/** The name and voice a new pet gets before the owner changes them. */
export const PET_KIND_DEFAULTS = {
  astronaut: { name: "Nova", voice: "talia" },
  alien: { name: "Zib", voice: "darian" },
  cat: { name: "Comet", voice: "maisie" },
} as const satisfies Record<PetKind, { name: string; voice: PetVoiceId }>;

export function isPetKind(value: unknown): value is PetKind {
  return (
    typeof value === "string" &&
    (PET_KINDS as readonly string[]).includes(value)
  );
}

/** A new pet's settings: awake, no quiet hours, notices spoken, saved notes sent. */
export function defaultPetSettings(kind: PetKind): PetSettings {
  return {
    paused: false,
    quietHours: null,
    speakNotices: true,
    volume: 0.6,
    voice: PET_KIND_DEFAULTS[kind].voice,
    savedNotes: "send",
  };
}
