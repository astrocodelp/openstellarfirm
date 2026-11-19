import {
  isConfirmCode,
  isSetupCode,
  makeConfirmCode,
  makeSetupCode,
  normalizeCode,
} from "../../shared/pets/codes";
import { defaultPetSettings, PET_KIND_DEFAULTS } from "../../shared/pets/kinds";
import { PET_LIMITS } from "../../shared/pets/limits";
import type {
  ClaimRequest,
  ClaimResponse,
  PairRequest,
  PairResponse,
  PetErrorCode,
} from "../../shared/pets/protocol";
import { newToken, sameText, sha256Base64url, sha256Hex } from "./digest";
import type { PetStore, StoredPairRequest } from "./store";

/**
 * Pairing, in the order the plan gives it: the owner makes a setup code, the
 * pet's request with that code opens a pairing whose confirm code the pet
 * says aloud, the owner types that code in the app (never a click alone), and
 * only then the pet's claim gets its token, once. The app keeps SHA-256
 * digests of the setup code, the confirm code and the token. Nothing here
 * touches a chat, an assistant or an approval: a pet can pair and nothing else.
 */

export interface PairingDeps {
  readonly store: PetStore;
  /** Epoch milliseconds. */
  readonly now: () => number;
  readonly randomBytes: (count: number) => Uint8Array;
  /** The address the pet's `approveUrl` names, for example `https://osf-1a2b3c4d.local:47820/`. */
  readonly approveUrl: () => string;
}

export type PairOutcome =
  | { readonly ok: true; readonly value: PairResponse }
  | { readonly ok: false; readonly code: PetErrorCode };

export type ClaimOutcome =
  | { readonly kind: "waiting" }
  | { readonly kind: "gone" }
  | { readonly kind: "claimed"; readonly value: ClaimResponse };

export type ConfirmOutcome =
  | { readonly result: "confirmed" }
  /** The code was well formed but not the one the pet said. */
  | { readonly result: "wrong"; readonly triesLeft: number }
  /** The code was not eight letters and digits; nothing is counted. */
  | { readonly result: "invalid" }
  /** Too many wrong tries, so the request is closed. */
  | { readonly result: "closed" }
  /** No pairing is waiting for a code. */
  | { readonly result: "none" };

export interface PendingPairing {
  readonly requestId: string;
  readonly kind: StoredPairRequest["kind"];
  readonly expiresAt: string;
  readonly triesLeft: number;
}

const setupHash = (code: string) => sha256Hex(`setup:${normalizeCode(code)}`);
const confirmHashOf = (requestId: string, code: string) =>
  sha256Hex(`confirm:${requestId}:${normalizeCode(code)}`);

export class Pairing {
  constructor(private readonly deps: PairingDeps) {}

  private get store(): PetStore {
    return this.deps.store;
  }

  /** Drops what ran out. Called before every read of codes and requests. */
  sweep(): void {
    const now = this.deps.now();
    const { setup, requests } = this.store.state;
    const liveSetup = setup.filter((s) => s.expiresAt > now);
    const liveRequests = requests.filter((r) => r.expiresAt > now);
    if (
      liveSetup.length !== setup.length ||
      liveRequests.length !== requests.length
    ) {
      this.store.change((state) => {
        state.setup = liveSetup;
        state.requests = liveRequests;
      });
    }
  }

  /**
   * A new setup code. It replaces any earlier one, and a pairing still waiting
   * for its confirm code is closed, so at most one pairing is ever open.
   */
  startAdding(): { code: string; expiresAt: string } {
    this.sweep();
    const code = makeSetupCode(this.deps.randomBytes);
    const expiresAt = this.deps.now() + PET_LIMITS.setupCodeTtlSeconds * 1000;
    this.store.change((state) => {
      state.setup = [{ hash: setupHash(code), expiresAt }];
      state.requests = state.requests.filter((r) => r.state === "approved");
    });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** The pet's request. A good setup code is spent here, once. */
  pair(request: PairRequest): PairOutcome {
    this.sweep();
    if (!isSetupCode(request.setupCode)) return { ok: false, code: "bad_code" };
    const hash = setupHash(request.setupCode);
    const known = this.store.state.setup.find((s) => sameText(s.hash, hash));
    if (!known) return { ok: false, code: "bad_code" };

    const now = this.deps.now();
    const id = Buffer.from(this.deps.randomBytes(16)).toString("base64url");
    const confirmCode = makeConfirmCode(this.deps.randomBytes);
    const expiresAt = now + PET_LIMITS.pairRequestTtlSeconds * 1000;
    this.store.change((state) => {
      state.setup = state.setup.filter((s) => s.hash !== known.hash);
      state.requests = [
        ...state.requests.filter((r) => r.state === "approved"),
        {
          id,
          kind: request.kind,
          hardware: request.hardware,
          firmware: request.firmware,
          deviceKey: request.deviceKey,
          confirmHash: confirmHashOf(id, confirmCode),
          createdAt: now,
          expiresAt,
          wrongTries: 0,
          state: "open",
        },
      ];
    });
    return {
      ok: true,
      value: {
        requestId: id,
        confirmCode,
        approveUrl: this.deps.approveUrl(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }

  /** The owner's typed confirm code. A click alone never gets here. */
  confirm(typed: string): ConfirmOutcome {
    this.sweep();
    const open = this.store.state.requests.find((r) => r.state === "open");
    if (!open) return { result: "none" };
    if (typeof typed !== "string" || !isConfirmCode(typed)) {
      return { result: "invalid" };
    }
    if (sameText(open.confirmHash, confirmHashOf(open.id, typed))) {
      this.store.change(() => {
        open.state = "approved";
      });
      return { result: "confirmed" };
    }
    const wrong = open.wrongTries + 1;
    const closed = wrong >= PET_LIMITS.confirmMaxWrongTries;
    this.store.change(() => {
      open.wrongTries = wrong;
      if (closed) open.state = "closed";
    });
    return closed
      ? { result: "closed" }
      : { result: "wrong", triesLeft: PET_LIMITS.confirmMaxWrongTries - wrong };
  }

  /** The pet's one-time claim. The token is made here and never kept. */
  claim(request: ClaimRequest): ClaimOutcome {
    this.sweep();
    const found = this.store.state.requests.find(
      (r) => r.id === request.requestId,
    );
    if (!found || found.state === "closed") return { kind: "gone" };
    // Only the pet that made the request holds the secret behind its key.
    const secret = Buffer.from(request.deviceSecret, "base64url");
    if (!sameText(sha256Base64url(secret), found.deviceKey)) {
      return { kind: "gone" };
    }
    if (found.state === "open") return { kind: "waiting" };

    const token = newToken(this.deps.randomBytes);
    const id = `pet-${Buffer.from(this.deps.randomBytes(12)).toString("hex")}`;
    const defaults = PET_KIND_DEFAULTS[found.kind];
    const settings = defaultPetSettings(found.kind);
    const now = new Date(this.deps.now()).toISOString();
    this.store.change((state) => {
      state.requests = state.requests.filter((r) => r.id !== found.id);
      state.pets = [
        ...state.pets,
        {
          id,
          name: defaults.name,
          kind: found.kind,
          pairedAt: now,
          lastSeenAt: null,
          tokenHash: sha256Hex(token),
          settings,
          firmware: found.firmware,
          battery: null,
          charging: null,
          rssi: null,
          queue: null,
        },
      ];
    });
    return {
      kind: "claimed",
      value: {
        deviceId: id,
        token,
        pet: { kind: found.kind, name: defaults.name, voice: defaults.voice },
        settings,
      },
    };
  }

  /** The pairing that waits for the owner's confirm code, if any. */
  pending(): PendingPairing | null {
    this.sweep();
    const open = this.store.state.requests.find((r) => r.state === "open");
    if (!open) return null;
    return {
      requestId: open.id,
      kind: open.kind,
      expiresAt: new Date(open.expiresAt).toISOString(),
      triesLeft: PET_LIMITS.confirmMaxWrongTries - open.wrongTries,
    };
  }

  /** When the live setup code runs out, if there is one. */
  setupExpiresAt(): string | null {
    this.sweep();
    const live = this.store.state.setup[0];
    return live ? new Date(live.expiresAt).toISOString() : null;
  }
}
