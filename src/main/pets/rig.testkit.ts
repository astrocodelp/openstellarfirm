import { createHash, randomBytes } from "node:crypto";
import type { Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PetSecrets, PetService, type PetServiceDeps } from "./service";

/** A secrets store in memory, with a switch for a computer with no keychain. */
export class FakeSecrets implements PetSecrets {
  readonly values = new Map<string, string>();
  usable = true;
  async available(): Promise<boolean> {
    return this.usable;
  }
  async get(id: string): Promise<string | undefined> {
    return this.values.get(id);
  }
  async set(id: string, value: string): Promise<void> {
    if (!this.usable) throw new Error("no keychain");
    this.values.set(id, value);
  }
  remove(id: string): void {
    this.values.delete(id);
  }
}

/** A UDP socket that never touches the network. */
export class FakeSocket extends EventEmitter {
  sent: { data: Buffer; port: number; address: string }[] = [];
  closed = false;
  memberships: string[] = [];
  bind(_port: number, done: () => void): void {
    queueMicrotask(done);
  }
  addMembership(group: string): void {
    this.memberships.push(group);
  }
  setMulticastTTL(): void {}
  send(
    data: Buffer,
    port: number,
    address: string,
    done?: (error: Error | null) => void,
  ): void {
    this.sent.push({ data, port, address });
    done?.(null);
  }
  close(): void {
    this.closed = true;
  }
}

export interface Rig {
  readonly dir: string;
  readonly file: string;
  readonly secrets: FakeSecrets;
  readonly service: PetService;
  readonly sockets: FakeSocket[];
  clock: { ms: number };
  cleanup(): Promise<void>;
}

export function makeRig(extra: Partial<PetServiceDeps> = {}): Rig {
  const dir = mkdtempSync(join(tmpdir(), "osf-pets-"));
  const file = join(dir, "desk-pets.json");
  const secrets = new FakeSecrets();
  const sockets: FakeSocket[] = [];
  const clock = { ms: Date.parse("2026-11-19T12:00:00Z") };
  const service = new PetService({
    file,
    secrets,
    now: () => clock.ms,
    host: "127.0.0.1",
    defaultPort: 0,
    interfaces: () => ({
      en0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    }),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as Socket;
    },
    ...extra,
  });
  return {
    dir,
    file,
    secrets,
    service,
    sockets,
    clock,
    async cleanup() {
      await service.shutdown();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Answer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  json: unknown;
  text: string;
}

/**
 * One call over real TLS to 127.0.0.1 with the certificate pinned: the
 * answer is thrown away unless the server's certificate hashes to
 * `fingerprint`, which is how a pet checks it too.
 */
export function call(
  port: number,
  fingerprint: string,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        rejectUnauthorized: false,
        agent: false,
        headers: options.headers,
      },
      (res) => {
        const raw = (
          res.socket as unknown as {
            getPeerCertificate(): { raw: Buffer };
          }
        ).getPeerCertificate().raw;
        const seen = createHash("sha256").update(raw).digest("hex");
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (seen !== fingerprint) {
            reject(new Error("The certificate is not the pinned one."));
            return;
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            json,
            text,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

export const jsonHeaders = { "Content-Type": "application/json" };

/** A pet's side of pairing: a secret, and the key the pet sends. */
export function newPetSecret(): { secret: string; deviceKey: string } {
  const bytes = randomBytes(32);
  return {
    secret: bytes.toString("base64url"),
    deviceKey: createHash("sha256").update(bytes).digest("base64url"),
  };
}

export function pairBody(
  setupCode: string,
  deviceKey: string,
  kind = "astronaut",
) {
  return JSON.stringify({
    setupCode,
    kind,
    hardware: "nano-esp32-v1",
    firmware: "0.1.0",
    deviceKey,
  });
}

export const heartbeatBody = JSON.stringify({
  battery: 0.8,
  charging: false,
  rssi: -50,
  firmware: "0.1.0",
  queue: 0,
  skin: "none",
  uptime: 10,
});
