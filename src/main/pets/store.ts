import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { isPetKind, type PetKind } from "../../shared/pets/kinds";
import {
  type PetSettings,
  parsePetName,
  parsePetSettings,
} from "../../shared/pets/protocol";

/**
 * What the app keeps about desk pets, in one JSON file in its data folder
 * (mode 0600, written whole and renamed into place like the sealed keys).
 * Setup codes, confirm codes and device tokens are kept only as SHA-256
 * digests, never as themselves. The certificate and its key are not here:
 * they live in the keychain-sealed `Secrets`.
 */

export interface StoredPet {
  readonly id: string;
  readonly name: string;
  readonly kind: PetKind;
  /** ISO time of the claim. */
  readonly pairedAt: string;
  /** ISO time of the last authenticated call, or null before the first. */
  lastSeenAt: string | null;
  /** SHA-256 of the device token, 64 hex characters. */
  readonly tokenHash: string;
  /** What the owner set; the pet is told it on a claim and on a heartbeat. */
  settings: PetSettings;
  /** From the last heartbeat; null before one. */
  firmware: string | null;
  battery: number | null;
  charging: boolean | null;
  rssi: number | null;
  queue: number | null;
}

export interface StoredSetupCode {
  /** SHA-256 of the normalized code. */
  readonly hash: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export type RequestState = "open" | "approved" | "closed";

export interface StoredPairRequest {
  readonly id: string;
  readonly kind: PetKind;
  readonly hardware: string;
  readonly firmware: string;
  /** The pet's `deviceKey`: base64url of the SHA-256 of its secret. */
  readonly deviceKey: string;
  /** SHA-256 of the confirm code the pet says. */
  readonly confirmHash: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  wrongTries: number;
  state: RequestState;
}

export interface DeskPetState {
  readonly v: 1;
  /** The owner's switch. Off until they turn it on. */
  enabled: boolean;
  /** The port the server last listened on, or null before the first start. */
  port: number | null;
  /** The random part of the mDNS name, `osf-<label>.local`. */
  readonly label: string;
  pets: StoredPet[];
  setup: StoredSetupCode[];
  requests: StoredPairRequest[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const LABEL = /^[0-9a-f]{8}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function iso(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value
    : null;
}

function readPet(value: unknown): StoredPet | null {
  if (!isRecord(value)) return null;
  const name = parsePetName(value.name);
  const settings = parsePetSettings(value.settings);
  const pairedAt = iso(value.pairedAt);
  if (
    typeof value.id !== "string" ||
    !name.ok ||
    !settings.ok ||
    !pairedAt ||
    !isPetKind(value.kind) ||
    typeof value.tokenHash !== "string" ||
    !HEX64.test(value.tokenHash)
  ) {
    return null;
  }
  const number = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    id: value.id,
    name: name.value,
    kind: value.kind,
    pairedAt,
    lastSeenAt: iso(value.lastSeenAt),
    tokenHash: value.tokenHash,
    settings: settings.value,
    firmware: typeof value.firmware === "string" ? value.firmware : null,
    battery: number(value.battery),
    charging: typeof value.charging === "boolean" ? value.charging : null,
    rssi: number(value.rssi),
    queue: number(value.queue),
  };
}

function readSetup(value: unknown): StoredSetupCode | null {
  if (
    !isRecord(value) ||
    typeof value.hash !== "string" ||
    !HEX64.test(value.hash) ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }
  return { hash: value.hash, expiresAt: value.expiresAt };
}

function readRequest(value: unknown): StoredPairRequest | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isPetKind(value.kind) ||
    typeof value.hardware !== "string" ||
    typeof value.firmware !== "string" ||
    typeof value.deviceKey !== "string" ||
    typeof value.confirmHash !== "string" ||
    !HEX64.test(value.confirmHash) ||
    typeof value.createdAt !== "number" ||
    typeof value.expiresAt !== "number" ||
    typeof value.wrongTries !== "number" ||
    (value.state !== "open" &&
      value.state !== "approved" &&
      value.state !== "closed")
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind,
    hardware: value.hardware,
    firmware: value.firmware,
    deviceKey: value.deviceKey,
    confirmHash: value.confirmHash,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    wrongTries: value.wrongTries,
    state: value.state,
  };
}

function list<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const one = read(item);
    return one ? [one] : [];
  });
}

export class PetStore {
  private current: DeskPetState;

  constructor(
    private readonly file: string,
    /** Bytes for the first mDNS label, handed in so tests are fixed. */
    private readonly randomBytes: (count: number) => Uint8Array,
  ) {
    this.current = this.load();
    // A label made just now is kept at once, so the name never changes.
    if (!this.hadLabel) this.save();
  }

  private hadLabel = true;

  private load(): DeskPetState {
    let raw: unknown;
    try {
      raw = existsSync(this.file)
        ? JSON.parse(readFileSync(this.file, "utf8"))
        : undefined;
    } catch {
      // A file that does not read is treated as empty: desk pets stay off
      // and nothing is paired. It is replaced on the next change.
      raw = undefined;
    }
    const o = isRecord(raw) && raw.v === 1 ? raw : {};
    const known = typeof o.label === "string" && LABEL.test(o.label);
    this.hadLabel = known;
    const label = known
      ? (o.label as string)
      : Buffer.from(this.randomBytes(4)).toString("hex");
    const port =
      typeof o.port === "number" &&
      Number.isInteger(o.port) &&
      o.port > 0 &&
      o.port < 65536
        ? o.port
        : null;
    return {
      v: 1,
      enabled: o.enabled === true,
      port,
      label,
      pets: list(o.pets, readPet),
      setup: list(o.setup, readSetup),
      requests: list(o.requests, readRequest),
    };
  }

  /** The state. Change it through `change`, which saves. */
  get state(): Readonly<DeskPetState> {
    return this.current;
  }

  /** Runs `edit` on the state and writes the file. */
  change<T>(edit: (state: DeskPetState) => T): T {
    const result = edit(this.current);
    this.save();
    return result;
  }

  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.current), { mode: 0o600 });
    // writeFileSync keeps an older file's mode; make sure of the new one.
    try {
      chmodSync(temp, 0o600);
    } catch {
      // Windows has no modes to set.
    }
    renameSync(temp, this.file);
  }

  /** Whether the saved file says desk pets are on, without building anything. */
  static savedOn(file: string): boolean {
    try {
      const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
      return isRecord(raw) && raw.v === 1 && raw.enabled === true;
    } catch {
      return false;
    }
  }
}
