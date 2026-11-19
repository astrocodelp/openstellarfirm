import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import type { Socket } from "node:net";
import { parseAfter, parseWait } from "../../shared/pets/inbox";
import { PET_LIMITS } from "../../shared/pets/limits";
import {
  isQuietNow,
  PET_AUDIO_DOWN_CONTENT_TYPE,
  PET_HEADERS,
  type PetErrorCode,
  parseClaimRequest,
  parseHeartbeatRequest,
  parsePairRequest,
  petError,
} from "../../shared/pets/protocol";
import { isPrivateAddress } from "./address";
import type { BackendReply, PetBackend } from "./backend";
import { sameText, sha256Hex } from "./digest";
import { RateLimiter } from "./limits";
import type { Pairing } from "./pairing";
import type { PetStore, StoredPet } from "./store";

/**
 * The desk pet server: one HTTPS port on the owner's own computer, for pets on
 * the same private network. It drops connections from any other address at
 * the socket, sends no cross-site headers, answers `no-store`, follows and
 * issues no redirects, and reads no body past its size cap. A pet holds a
 * device token and can call these routes, which pair it, keep it seen and (in
 * a later phase) carry its turns. There is no route that touches an approval,
 * a held tool call or a chat setting, and `pets-boundary.test.ts` pins that.
 */

export interface RouteInfo {
  readonly method: "GET" | "POST";
  /** A description of the path, with `:n` and `:voice` for the variable parts. */
  readonly path: string;
  /** Whether the call needs the device token. */
  readonly auth: boolean;
}

/** Every route the server answers; anything else is 404. */
export const PET_ROUTES: readonly RouteInfo[] = [
  { method: "POST", path: "/api/pets/pair", auth: false },
  { method: "POST", path: "/api/pets/pair/claim", auth: false },
  { method: "POST", path: "/api/pets/heartbeat", auth: true },
  { method: "POST", path: "/api/pets/turn", auth: true },
  { method: "GET", path: "/api/pets/say/:n", auth: true },
  { method: "GET", path: "/api/pets/inbox", auth: true },
  { method: "GET", path: "/pets/voice/:voice.sfvp", auth: false },
];

/** The largest JSON body a pet sends: a heartbeat is about 150 bytes. */
export const JSON_BODY_MAX_BYTES = 4096;
export const DEFAULT_PORT = 47820;

/** Spoken calls a minute (the say route) for one pet. */
const SAYS_PER_MINUTE = 20;
const DAY_MS = 86_400_000;

/** Calls a minute a pet may make that carry its token. */
const AUTH_CALLS_PER_MINUTE = 30;
const HEARTBEATS_PER_MINUTE = 12;
/** Calls without a good token a minute, for one address. */
const AUTH_FAILURES_PER_MINUTE = 30;
const CLAIMS_PER_MINUTE = 30;
const PACKS_PER_MINUTE = 20;

export interface PetServerDeps {
  readonly store: PetStore;
  readonly pairing: Pairing;
  /** Turns, notices, spoken lines and voice packs. Without it they answer 503. */
  readonly backend?: PetBackend;
  /** Called once a pet's claim worked, with its id (for its hello and its voice). */
  readonly onPaired?: (petId: string) => void;
  readonly keyPem: string;
  readonly certPem: string;
  /** Epoch milliseconds. */
  readonly now: () => number;
  /** Whether a remote address may connect; the app passes `isPrivateAddress`. */
  readonly allowAddress?: (address: string | undefined) => boolean;
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

type Reply = (
  status: number,
  body: unknown,
  extra?: Record<string, string>,
) => void;

/** Answers with bytes: speech or a voice pack. */
type Raw = (
  status: number,
  type: string,
  bytes: Uint8Array,
  extra?: Record<string, string>,
) => void;

/** The `X-Pet-*` headers of a turn's or a notice's speech. */
function speechHeaders(
  reply: Extract<BackendReply, { kind: "audio" }>,
): Record<string, string> {
  return {
    ...(reply.state ? { [PET_HEADERS.state]: reply.state } : {}),
    [PET_HEADERS.line]: encodeURIComponent(reply.line),
    ...(reply.chat ? { [PET_HEADERS.chat]: reply.chat } : {}),
    ...(reply.run ? { [PET_HEADERS.run]: reply.run } : {}),
  };
}

class TooLarge extends Error {}

export class PetServer {
  private server: Server | null = null;
  private readonly limiter: RateLimiter;
  private readonly allow: (address: string | undefined) => boolean;

  constructor(private readonly deps: PetServerDeps) {
    this.limiter = new RateLimiter(deps.now);
    this.allow = deps.allowAddress ?? isPrivateAddress;
  }

  get listening(): boolean {
    return this.server?.listening === true;
  }

  /**
   * Starts listening. A busy `port` falls back to one the system picks, and the
   * port that was bound is returned so the caller can save it.
   */
  async start(options: { host?: string; port: number }): Promise<number> {
    if (this.server) throw new Error("The desk pet server is already running.");
    const server = createServer(
      {
        key: this.deps.keyPem,
        cert: this.deps.certPem,
        minVersion: "TLSv1.2",
        maxHeaderSize: 8192,
      },
      (req, res) => this.handle(req, res),
    );
    server.requestTimeout = 60_000;
    server.headersTimeout = 15_000;
    server.keepAliveTimeout = 5_000;
    // Before a byte of TLS is read: an address off the private network is
    // dropped on the spot.
    server.on("connection", (socket: Socket) => {
      if (!this.allow(socket.remoteAddress)) socket.destroy();
    });
    server.on("tlsClientError", (_error, socket) => socket.destroy());
    server.on("clientError", (_error, socket) => socket.destroy());

    const listen = (port: number) =>
      new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once("error", failed);
        server.listen({ port, host: options.host }, () => {
          server.removeListener("error", failed);
          resolve();
        });
      });
    try {
      try {
        await listen(options.port);
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
          options.port === 0
        ) {
          throw error;
        }
        await listen(0);
      }
    } catch (error) {
      server.close();
      throw error;
    }
    this.server = server;
    const address = server.address();
    return typeof address === "object" && address ? address.port : options.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  // -- Answering -------------------------------------------------------------

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const reply: Reply = (status, body, extra) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extra,
      });
      res.end(text);
    };
    const raw: Raw = (status, type, bytes, extra) => {
      res.writeHead(status, {
        "Content-Type": type,
        "Content-Length": bytes.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...extra,
      });
      res.end(bytes);
    };
    const fail = (code: PetErrorCode) => {
      const { status, body } = petError(code);
      reply(status, body);
    };
    // The answer's own close, not the request's: a pet that gives up on a held
    // call closes the connection.
    const closed = new AbortController();
    res.on("close", () => closed.abort());
    this.route(req, reply, fail, raw, closed.signal).catch(() => {
      if (!res.headersSent) fail("bad_request");
      else res.destroy();
    });
  }

  private async route(
    req: IncomingMessage,
    reply: Reply,
    fail: (code: PetErrorCode) => void,
    raw: Raw,
    closed: AbortSignal,
  ): Promise<void> {
    const address = req.socket.remoteAddress ?? "unknown";
    // Only the path is read. The query is the inbox's own and is never logged.
    const url = new URL(req.url ?? "/", "https://pet.invalid");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "POST" && path === "/api/pets/pair") {
      return this.pair(req, address, reply, fail);
    }
    if (method === "POST" && path === "/api/pets/pair/claim") {
      return this.claim(req, address, reply, fail);
    }
    if (method === "POST" && path === "/api/pets/heartbeat") {
      const pet = this.authenticate(req, address, fail);
      if (!pet) return;
      return this.heartbeat(req, pet, reply, fail);
    }
    if (method === "POST" && path === "/api/pets/turn") {
      const pet = this.authenticate(req, address, fail);
      if (!pet) return;
      if (
        !this.limiter.take(`turn:${pet.id}`, PET_LIMITS.turnsPerMinute) ||
        !this.limiter.take(`turn-day:${pet.id}`, PET_LIMITS.turnsPerDay, DAY_MS)
      ) {
        return fail("too_many");
      }
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > PET_LIMITS.uploadMaxBytes) return fail("too_long");
      // The upload is read whole, then dropped from memory with the reply.
      let body: Buffer;
      try {
        body = await this.readBody(req, PET_LIMITS.uploadMaxBytes);
      } catch (error) {
        return fail(error instanceof TooLarge ? "too_long" : "bad_request");
      }
      const backend = this.deps.backend;
      if (!backend) return fail("voice_off");
      const turnId = req.headers[PET_HEADERS.turn.toLowerCase()];
      return this.give(
        await backend.turn(pet, {
          turnId: typeof turnId === "string" ? turnId : undefined,
          offline: req.headers[PET_HEADERS.offline.toLowerCase()] === "1",
          body,
        }),
        reply,
        raw,
      );
    }
    const say = /^\/api\/pets\/say\/(\d{1,10})$/.exec(path);
    if (method === "GET" && say) {
      const pet = this.authenticate(req, address, fail);
      if (!pet) return;
      if (!this.limiter.take(`say:${pet.id}`, SAYS_PER_MINUTE)) {
        return fail("too_many");
      }
      const backend = this.deps.backend;
      if (!backend) return fail("voice_off");
      return this.give(await backend.say(pet, Number(say[1])), reply, raw);
    }
    if (method === "GET" && path === "/api/pets/inbox") {
      const pet = this.authenticate(req, address, fail);
      if (!pet) return;
      const backend = this.deps.backend;
      if (!backend) return fail("store_off");
      const answer = await backend.inbox(
        pet,
        parseAfter(url.searchParams.get("after")),
        parseWait(url.searchParams.get("wait")),
        closed,
      );
      if (closed.aborted) return;
      return reply(200, answer);
    }
    const pack = /^\/pets\/voice\/([a-z]{3,12})\.sfvp$/.exec(path);
    if (method === "GET" && pack) {
      // The firmware fetches a voice pack with no token, so this route cannot
      // ask for one. It answers only for the voices the protocol names.
      if (!this.limiter.take(`pack:${address}`, PACKS_PER_MINUTE)) {
        return fail("too_many");
      }
      const backend = this.deps.backend;
      if (!backend) return fail("voice_off");
      const answer = await backend.pack(pack[1] ?? "");
      return answer.kind === "file"
        ? raw(200, "application/octet-stream", answer.bytes)
        : reply(answer.status, answer.body);
    }
    reply(404, { error: "not_found" });
  }

  /** Writes a backend's answer: JSON, or speech with its `X-Pet-*` headers. */
  private give(answer: BackendReply, reply: Reply, raw: Raw): void {
    if (answer.kind === "json") {
      reply(answer.status, answer.body);
      return;
    }
    raw(200, PET_AUDIO_DOWN_CONTENT_TYPE, answer.pcm, speechHeaders(answer));
  }

  // -- Bodies ----------------------------------------------------------------

  /** Reads at most `max` bytes; more is `TooLarge`, and the rest is dropped. */
  private readBody(req: IncomingMessage, max: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers["content-length"] ?? 0);
      if (declared > max) {
        req.resume();
        reject(new TooLarge());
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > max) {
          chunks.length = 0;
          req.removeAllListeners("data");
          req.resume();
          reject(new TooLarge());
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  private async json(
    req: IncomingMessage,
    fail: (code: PetErrorCode) => void,
  ): Promise<{ value: unknown } | null> {
    let body: Buffer;
    try {
      body = await this.readBody(req, JSON_BODY_MAX_BYTES);
    } catch (error) {
      fail(error instanceof TooLarge ? "too_long" : "bad_request");
      return null;
    }
    try {
      return { value: JSON.parse(body.toString("utf8")) as unknown };
    } catch {
      fail("bad_request");
      return null;
    }
  }

  // -- Authentication --------------------------------------------------------

  /** The pet whose token the request carries, or null after answering 401. */
  private authenticate(
    req: IncomingMessage,
    address: string,
    fail: (code: PetErrorCode) => void,
  ): StoredPet | null {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
    const token = match?.[1];
    let found: StoredPet | null = null;
    if (token && TOKEN_SHAPE.test(token)) {
      const hash = sha256Hex(token);
      // Every pet is compared, in constant time each, so the answer's timing
      // says nothing about which hash came close.
      for (const pet of this.deps.store.state.pets) {
        if (sameText(pet.tokenHash, hash)) found = pet;
      }
    }
    if (!found) {
      fail(
        this.limiter.take(`auth-fail:${address}`, AUTH_FAILURES_PER_MINUTE)
          ? "forgotten"
          : "too_many",
      );
      return null;
    }
    if (!this.limiter.take(`auth:${found.id}`, AUTH_CALLS_PER_MINUTE)) {
      fail("too_many");
      return null;
    }
    return found;
  }

  // -- Pairing and heartbeat -------------------------------------------------

  private async pair(
    req: IncomingMessage,
    address: string,
    reply: Reply,
    fail: (code: PetErrorCode) => void,
  ): Promise<void> {
    if (!this.limiter.take(`pair:${address}`, PET_LIMITS.pairPerMinute)) {
      return fail("too_many");
    }
    const body = await this.json(req, fail);
    if (!body) return;
    const parsed = parsePairRequest(body.value);
    if (!parsed.ok) return fail("bad_request");
    const outcome = this.deps.pairing.pair(parsed.value);
    if (!outcome.ok) return fail(outcome.code);
    reply(200, outcome.value);
  }

  private async claim(
    req: IncomingMessage,
    address: string,
    reply: Reply,
    fail: (code: PetErrorCode) => void,
  ): Promise<void> {
    if (!this.limiter.take(`claim:${address}`, CLAIMS_PER_MINUTE)) {
      return fail("too_many");
    }
    const body = await this.json(req, fail);
    if (!body) return;
    const parsed = parseClaimRequest(body.value);
    if (!parsed.ok) return fail("bad_request");
    const outcome = this.deps.pairing.claim(parsed.value);
    if (outcome.kind === "gone") return fail("gone");
    if (outcome.kind === "waiting") return reply(202, { status: "waiting" });
    reply(200, outcome.value);
    try {
      this.deps.onPaired?.(outcome.value.deviceId);
    } catch {
      // A hello that could not be made never undoes a pairing.
    }
  }

  private async heartbeat(
    req: IncomingMessage,
    pet: StoredPet,
    reply: Reply,
    fail: (code: PetErrorCode) => void,
  ): Promise<void> {
    if (!this.limiter.take(`heartbeat:${pet.id}`, HEARTBEATS_PER_MINUTE)) {
      return fail("too_many");
    }
    const body = await this.json(req, fail);
    if (!body) return;
    const parsed = parseHeartbeatRequest(body.value);
    if (!parsed.ok) return fail("bad_request");
    const now = this.deps.now();
    this.deps.store.change(() => {
      pet.lastSeenAt = new Date(now).toISOString();
      pet.firmware = parsed.value.firmware;
      pet.battery = parsed.value.battery;
      pet.charging = parsed.value.charging;
      pet.rssi = parsed.value.rssi;
      pet.queue = parsed.value.queue;
    });
    reply(200, {
      settings: pet.settings,
      quiet: isQuietNow(pet.settings.quietHours, new Date(now)),
    });
  }
}
