import type { PetKind, PetVoiceId } from "./pets/kinds";

/**
 * What the page may know about desk pets. Never a token, a code hash, the
 * certificate's key or a setup code that is not the one just made.
 */

export interface DeskPetView {
  readonly id: string;
  readonly name: string;
  readonly kind: PetKind;
  readonly pairedAt: string;
  readonly lastSeenAt: string | null;
  /** Seen within the protocol's online window. */
  readonly online: boolean;
  readonly firmware: string | null;
  readonly battery: number | null;
  readonly charging: boolean | null;
  readonly voice: PetVoiceId;
  /** The assistant its turns go to; null is the main assistant. */
  readonly assistantId: string | null;
  /** Whether it says the assistant's answer or only a short done line. */
  readonly speakAnswers: boolean;
}

/** What the owner may change about one pet, apart from its name. */
export interface DeskPetConfig {
  readonly assistantId?: string | null;
  readonly voice?: PetVoiceId;
  readonly speakAnswers?: boolean;
}

/** A note a pet saved offline, kept as text for the owner to read and send. */
export interface DeskPetDraft {
  readonly id: string;
  readonly petId: string;
  readonly assistantId: string;
  readonly text: string;
  readonly at: string;
}

export interface DeskPetPending {
  readonly requestId: string;
  readonly kind: PetKind;
  readonly expiresAt: string;
  readonly triesLeft: number;
}

export interface DeskPetsStatus {
  /** The owner's switch. */
  readonly enabled: boolean;
  /** Whether the server is listening right now. */
  readonly running: boolean;
  readonly port: number | null;
  /** `osf-<label>.local`, the one name the app answers. */
  readonly mdnsName: string;
  readonly mdnsRunning: boolean;
  /** SHA-256 of the certificate, 64 lowercase hex characters, or null before the first. Not a secret. */
  readonly fingerprint: string | null;
  /** This computer's private network addresses (no link-local), for the pet to try first. */
  readonly addresses: readonly string[];
  readonly pets: readonly DeskPetView[];
  readonly pending: DeskPetPending | null;
  readonly drafts: readonly DeskPetDraft[];
  /** Whether an ElevenLabs key is saved. The key itself is never sent. */
  readonly voiceKey: boolean;
  /** A plain sentence when speech was refused or ran out, else null. */
  readonly voiceProblem: string | null;
  /** When the setup code last made runs out, or null. */
  readonly setupExpiresAt: string | null;
  /** A plain sentence when something is wrong, such as a start that failed. */
  readonly problem: string | null;
}

export interface DeskPetSetupCode {
  /** Shown `XXXXX-XXXXX`. */
  readonly code: string;
  readonly expiresAt: string;
}

export type DeskPetConfirm =
  | { readonly result: "confirmed" }
  | { readonly result: "wrong"; readonly triesLeft: number }
  | { readonly result: "invalid" }
  | { readonly result: "closed" }
  | { readonly result: "none" };
