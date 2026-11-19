import type { PetKind } from "./pets/kinds";

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
  /** SHA-256 of the certificate, 64 lowercase hex characters, or null before the first. */
  readonly fingerprint: string | null;
  readonly pets: readonly DeskPetView[];
  readonly pending: DeskPetPending | null;
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
