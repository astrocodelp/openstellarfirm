import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { isPublicAddress } from "./web";

/**
 * A read-only IMAP client, written for this app.
 *
 * It can look and nothing else. A mailbox is opened with EXAMINE, never the
 * command that opens it for changes, and a message is fetched with BODY.PEEK,
 * so nothing is marked as read. Every command goes through `send`, which
 * accepts only the six exact shapes in COMMANDS: there is no way to store a
 * flag, copy, move, delete, create, rename or add a message, and no way to
 * send mail (this is not SMTP).
 *
 * The connection is TLS from the first byte, with the certificate checked
 * against the name the person typed. Everything the server sends is outside
 * text: a line, a response, a wait and a literal are each bounded, and a
 * server that sends anything unexpected ends the session.
 */

/** A short, plain sentence for the person. It never holds a password. */
export class MailError extends Error {}

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const COMMAND_TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 64 * 1024;
/** The most messages one listing looks at: the newest ones. */
export const MAX_CANDIDATES = 100;
/** How much of one message is fetched. */
export const MAX_MESSAGE_BYTES = 2_000_000;
const MAX_FOLDERS_SHOWN = 30;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * The only commands this client can send. `send` throws on anything else, so
 * a bug or a hostile folder name can never make another command.
 */
const QUOTED = String.raw`(?:[\x20\x21\x23-\x5b\x5d-\x7e]|\\["\\])*`;
const COMMANDS: RegExp[] = [
  new RegExp(`^LOGIN "${QUOTED}" "${QUOTED}"$`),
  /^LIST "" "\*"$/,
  new RegExp(`^EXAMINE "${QUOTED}"$`),
  /^UID SEARCH (?:UNSEEN )?SINCE \d{1,2}-[A-Z][a-z]{2}-\d{4}$/,
  /^UID FETCH \d{1,10}(?:,\d{1,10}){0,99} \(UID FLAGS INTERNALDATE BODY\.PEEK\[HEADER\.FIELDS \(FROM TO CC SUBJECT DATE\)\]\)$/,
  /^UID FETCH \d{1,10} \(UID BODY\.PEEK\[\]<0\.\d{1,8}>\)$/,
  /^LOGOUT$/,
];

/** Quotes text for a command, or says it cannot be sent. */
export function quoted(value: string): string {
  if (!/^[\x20-\x7e]*$/.test(value))
    throw new MailError(
      "Only plain letters, numbers and symbols can be used here.",
    );
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/** A folder name, checked. Plain ASCII only, with INBOX in its usual form. */
export function checkFolder(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "INBOX";
  if (typeof raw !== "string" || raw.length > 100)
    throw new MailError("That folder name is not allowed.");
  const name = raw.trim();
  if (!/^[\x20-\x7e]{1,100}$/.test(name) || name === "")
    throw new MailError(
      "Only folder names written in plain letters and numbers can be read.",
    );
  return name.toUpperCase() === "INBOX" ? "INBOX" : name;
}

/** The IMAP date form, such as 5-Nov-2026. */
export function imapDate(date: Date): string {
  return `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

// ---- The server's address ----

/** A host name the person typed, or why it cannot be used. */
export function checkMailHost(raw: unknown, ownNetwork: boolean): string {
  if (typeof raw !== "string") throw new MailError("Type the server's name.");
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!host) throw new MailError("Type the server's name.");
  if (host.length > 253 || isIP(host.replace(/^\[|\]$/g, "")) !== 0)
    throw new MailError(
      "Use the server's name, such as imap.example.com, not an address.",
    );
  const labels = host.split(".");
  if (
    !labels.every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw new MailError("That is not a server name.");
  if (labels.length < 2 && !ownNetwork)
    throw new MailError(
      "Use the server's full name, such as imap.example.com.",
    );
  return host;
}

export function checkPort(raw: unknown): number {
  const port = raw === undefined || raw === "" ? 993 : raw;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new MailError(
      "The port is a number from 1 to 65535. It is usually 993.",
    );
  return port;
}

/** True for an address that is never a mail server, even on a home network. */
function neverUsable(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0] = address.split(".").map(Number);
    return a === 0 || a >= 224;
  }
  const lower = address.toLowerCase();
  return lower === "::" || lower.startsWith("ff");
}

export interface ImapDeps {
  resolve(host: string): Promise<{ address: string; family: number }[]>;
  /** A TLS connection to this checked address, already secure and verified. */
  connect(to: { host: string; address: string; port: number }): Promise<Duplex>;
  now(): Date;
  timeoutMs?: number;
  maxBytes?: number;
}

/** The TLS settings: certificate checked against the typed name, always. */
export function tlsOptions(
  host: string,
  address: string,
  port: number,
): tls.ConnectionOptions {
  return {
    host: address,
    port,
    servername: host,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  };
}

export const nodeImapDeps: ImapDeps = {
  resolve: (host) => dnsLookup(host, { all: true }),
  connect: ({ host, address, port }) =>
    new Promise((resolve, reject) => {
      const socket = tls.connect(tlsOptions(host, address, port));
      socket.setTimeout(COMMAND_TIMEOUT_MS, () =>
        socket.destroy(new MailError("The server took too long to answer.")),
      );
      socket.once("secureConnect", () => {
        socket.setTimeout(0);
        if (!socket.authorized) {
          socket.destroy();
          reject(
            new MailError(
              "The server's certificate is not trusted, so the app did not connect.",
            ),
          );
          return;
        }
        resolve(socket);
      });
      socket.once("error", reject);
    }),
  now: () => new Date(),
};

/** A plain sentence for anything that went wrong on the way. */
export function connectFailure(error: unknown): MailError {
  if (error instanceof MailError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (
      /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME|HOSTNAME_MISMATCH|ERR_TLS/.test(
        code,
      )
    )
      return new MailError(
        "The server's certificate is not trusted, so the app did not connect.",
      );
    if (code === "ECONNREFUSED")
      return new MailError(
        "The server refused the connection. Check the port.",
      );
    if (code === "ENOTFOUND")
      return new MailError("That server name could not be found.");
    if (code === "ETIMEDOUT" || code === "ECONNRESET")
      return new MailError("The server did not answer.");
  }
  return new MailError("Could not connect to the server.");
}

// ---- Responses ----

type Part = { text: string } | { literal: Buffer };

interface Response {
  parts: Part[];
}

function firstText(response: Response): string {
  const first = response.parts[0];
  return first && "text" in first ? first.text : "";
}

/** Every text piece of a response, so a field after a literal is found too. */
function allText(response: Response): string {
  return response.parts
    .map((part) => ("text" in part ? part.text : " "))
    .join(" ");
}

export interface Head {
  uid: number;
  unread: boolean;
  internalDate: Date | undefined;
  /** The raw header lines, to be read by the mail module. */
  header: Buffer;
}

export interface Server {
  host: string;
  port: number;
  username: string;
  ownNetwork: boolean;
}

/** One signed-in session. A session lives for one tool call. */
class Session {
  private buffer = Buffer.alloc(0);
  private received = 0;
  private failure: MailError | undefined;
  private wake: (() => void) | undefined;
  private tagNumber = 0;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(
    private readonly stream: Duplex,
    deps: ImapDeps,
    signal?: AbortSignal,
  ) {
    this.timeoutMs = deps.timeoutMs ?? COMMAND_TIMEOUT_MS;
    this.maxBytes = deps.maxBytes ?? MAX_RESPONSE_BYTES;
    stream.on("data", (chunk: Buffer) => this.feed(chunk));
    stream.on("end", () => this.fail(new MailError("The server hung up.")));
    stream.on("close", () => this.fail(new MailError("The server hung up.")));
    stream.on("error", (error) => this.fail(connectFailure(error)));
    if (signal) {
      if (signal.aborted) this.fail(new MailError("Stopped."));
      else
        signal.addEventListener(
          "abort",
          () => this.fail(new MailError("Stopped.")),
          { once: true },
        );
    }
  }

  private fail(error: MailError): void {
    if (!this.failure) this.failure = error;
    this.stream.destroy();
    this.wake?.();
  }

  private feed(chunk: Buffer): void {
    this.received += chunk.length;
    if (this.received > this.maxBytes) {
      this.fail(new MailError("The server sent too much, so it was stopped."));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.wake?.();
  }

  /** The next whole response, or undefined when more bytes are needed. */
  private parse(): Response | undefined {
    const parts: Part[] = [];
    let pos = 0;
    for (;;) {
      const eol = this.buffer.indexOf("\r\n", pos);
      if (eol < 0) {
        if (this.buffer.length - pos > MAX_LINE_BYTES)
          throw new MailError("The server sent a line that is too long.");
        return undefined;
      }
      if (eol - pos > MAX_LINE_BYTES)
        throw new MailError("The server sent a line that is too long.");
      const line = this.buffer.toString("latin1", pos, eol);
      const literal = /\{(\d{1,10})\}$/.exec(line);
      if (!literal) {
        parts.push({ text: line });
        this.buffer = this.buffer.subarray(eol + 2);
        return { parts };
      }
      const size = Number(literal[1]);
      if (size > this.maxBytes)
        throw new MailError("The server sent too much, so it was stopped.");
      const start = eol + 2;
      if (this.buffer.length < start + size) return undefined;
      parts.push({ text: line });
      parts.push({
        literal: Buffer.from(this.buffer.subarray(start, start + size)),
      });
      pos = start + size;
    }
  }

  private async next(): Promise<Response> {
    for (;;) {
      if (this.failure) throw this.failure;
      let response: Response | undefined;
      try {
        response = this.parse();
      } catch (error) {
        const failure =
          error instanceof MailError ? error : new MailError("Bad answer.");
        this.fail(failure);
        throw failure;
      }
      if (response) return response;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }

  /** Waits for the server's first line. */
  async greeting(): Promise<void> {
    const timer = this.startTimer();
    try {
      const response = await this.next();
      if (!/^\* OK\b/i.test(firstText(response)))
        throw new MailError("That server did not welcome the connection.");
    } finally {
      clearTimeout(timer);
    }
  }

  private startTimer(): NodeJS.Timeout {
    return setTimeout(
      () => this.fail(new MailError("The server took too long to answer.")),
      this.timeoutMs,
    );
  }

  /** The one place a command is written. Anything off the list is refused. */
  async send(
    command: string,
  ): Promise<{ status: "OK" | "NO" | "BAD"; untagged: Response[] }> {
    if (!COMMANDS.some((shape) => shape.test(command)))
      throw new MailError("That request is not allowed.");
    this.tagNumber += 1;
    const tag = `a${this.tagNumber}`;
    // Each command gets its own allowance of bytes.
    this.received = this.buffer.length;
    const timer = this.startTimer();
    try {
      if (this.failure) throw this.failure;
      this.stream.write(`${tag} ${command}\r\n`);
      const untagged: Response[] = [];
      for (;;) {
        const response = await this.next();
        const head = firstText(response);
        if (head.startsWith("* ")) {
          if (/^\* BYE\b/i.test(head))
            throw new MailError("The server ended the session.");
          untagged.push(response);
          continue;
        }
        if (head.startsWith(`${tag} `)) {
          const status = /^\S+ (OK|NO|BAD)\b/i.exec(head)?.[1]?.toUpperCase();
          if (status !== "OK" && status !== "NO" && status !== "BAD")
            throw new MailError(
              "The server sent an answer the app did not understand.",
            );
          return { status, untagged };
        }
        // A request for more input, or anything else out of turn.
        throw new MailError(
          "The server sent something the app did not expect, so it stopped.",
        );
      }
    } catch (error) {
      const failure =
        error instanceof MailError ? error : connectFailure(error);
      this.fail(failure);
      throw this.failure ?? failure;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.stream.destroy();
  }
}

/** The server's own date, such as " 5-Nov-2026 09:12:00 +0100", or nothing. */
export function parseInternalDate(text: string): Date | undefined {
  const m =
    /^\s*(\d{1,2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(
      text,
    );
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2] ?? "");
  if (month < 0) return undefined;
  const offset =
    (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  const time =
    Date.UTC(
      Number(m[3]),
      month,
      Number(m[1]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ) - offset;
  return Number.isNaN(time) ? undefined : new Date(time);
}

/** Looks inside one "* n FETCH (...)" response for what was asked. */
function readFetch(response: Response): Head | undefined {
  const parts = response.parts;
  const lead = firstText(response);
  if (!/^\* \d+ FETCH\b/i.test(lead)) return undefined;
  const text = allText(response);
  const uid = /\bUID (\d{1,10})\b/i.exec(text)?.[1];
  if (!uid) return undefined;
  const flags = /\bFLAGS \(([^)]*)\)/i.exec(text)?.[1] ?? "";
  const stamp = /\bINTERNALDATE "([^"]{1,40})"/i.exec(text)?.[1];
  const parsed = stamp ? parseInternalDate(stamp) : undefined;
  const literal = parts.find((p): p is { literal: Buffer } => "literal" in p);
  // A header small enough to be a quoted string is read too.
  const quotedHeader = /BODY\[[^\]]*\] "((?:[^"\\]|\\.)*)"/i.exec(lead)?.[1];
  return {
    uid: Number(uid),
    unread: !/\\Seen\b/i.test(flags),
    internalDate: parsed,
    header: literal
      ? literal.literal
      : Buffer.from(quotedHeader?.replace(/\\(.)/g, "$1") ?? "", "latin1"),
  };
}

export interface Listing {
  /** Names the mailbox's current numbering; a message id is good for it. */
  validity: string;
  heads: Head[];
}

/** What the client needs from a mail account: the server and its password. */
export class ImapClient {
  constructor(
    private readonly server: Server,
    private readonly password: () => Promise<string | undefined>,
    private readonly deps: ImapDeps = nodeImapDeps,
    private readonly signal?: AbortSignal,
  ) {}

  /** Connects, signs in, runs one thing, signs out. The password is held only here. */
  private async session<T>(run: (session: Session) => Promise<T>): Promise<T> {
    const host = checkMailHost(this.server.host, this.server.ownNetwork);
    const port = checkPort(this.server.port);
    let addresses: { address: string; family: number }[];
    try {
      addresses = await this.deps.resolve(host);
    } catch {
      throw new MailError("That server name could not be found.");
    }
    const to = addresses[0];
    if (!to) throw new MailError("That server name could not be found.");
    if (this.server.ownNetwork) {
      if (addresses.some((entry) => neverUsable(entry.address)))
        throw new MailError("That name does not lead to a mail server.");
    } else if (!addresses.every((entry) => isPublicAddress(entry.address))) {
      throw new MailError(
        "That name leads to an address on a private network. If the server is on your own network, tick the box that says so.",
      );
    }
    const password = await this.password();
    if (!password)
      throw new MailError(
        "No password is saved for this account. Add it again.",
      );
    let stream: Duplex;
    try {
      stream = await this.deps.connect({ host, address: to.address, port });
    } catch (error) {
      throw connectFailure(error);
    }
    const session = new Session(stream, this.deps, this.signal);
    try {
      await session.greeting();
      const login = await session.send(
        `LOGIN ${quoted(this.server.username)} ${quoted(password)}`,
      );
      if (login.status !== "OK")
        throw new MailError(
          "The server did not accept the sign-in. Check the username and the app password.",
        );
      const result = await run(session);
      await session.send("LOGOUT").catch(() => undefined);
      return result;
    } finally {
      session.close();
    }
  }

  /** Signs in, lists the folders and signs out. Nothing is read from any folder. */
  check(): Promise<{ folders: string[]; more: number }> {
    return this.session(async (session) => {
      const answer = await session.send('LIST "" "*"');
      if (answer.status !== "OK")
        throw new MailError("The server would not list its folders.");
      const names: string[] = [];
      for (const response of answer.untagged) {
        const name = listName(response);
        if (name) names.push(name);
      }
      return {
        folders: names.slice(0, MAX_FOLDERS_SHOWN),
        more: Math.max(0, names.length - MAX_FOLDERS_SHOWN),
      };
    });
  }

  private async open(session: Session, folder: string): Promise<string> {
    const opened = await session.send(`EXAMINE ${quoted(checkFolder(folder))}`);
    if (opened.status !== "OK")
      throw new MailError("That folder could not be opened.");
    for (const response of opened.untagged) {
      const found = /UIDVALIDITY (\d{1,10})/i.exec(firstText(response))?.[1];
      if (found) return found;
    }
    return "";
  }

  /** The newest messages since a date: their headers only. */
  async list(
    folder: string,
    sinceDays: number,
    unreadOnly: boolean,
  ): Promise<Listing> {
    // Checked before anything is connected: a bad name makes no connection.
    checkFolder(folder);
    return this.session(async (session) => {
      const validity = await this.open(session, folder);
      // One day earlier than asked: the server compares dates only, and the
      // exact cut is made by the app on each message's own time.
      const since = new Date(
        this.deps.now().getTime() - (sinceDays + 1) * 86_400_000,
      );
      const found = await session.send(
        `UID SEARCH ${unreadOnly ? "UNSEEN " : ""}SINCE ${imapDate(since)}`,
      );
      if (found.status !== "OK")
        throw new MailError("The server could not look through that folder.");
      const uids: number[] = [];
      for (const response of found.untagged) {
        const line = firstText(response);
        if (!/^\* SEARCH\b/i.test(line)) continue;
        for (const word of line.slice(8).split(/\s+/)) {
          if (/^\d{1,10}$/.test(word)) uids.push(Number(word));
        }
      }
      uids.sort((a, b) => a - b);
      const newest = uids.slice(-MAX_CANDIDATES);
      if (newest.length === 0) return { validity, heads: [] };
      const fetched = await session.send(
        `UID FETCH ${newest.join(",")} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE)])`,
      );
      if (fetched.status !== "OK")
        throw new MailError("The server could not give the message list.");
      const wanted = new Set(newest);
      const heads: Head[] = [];
      for (const response of fetched.untagged) {
        const head = readFetch(response);
        // A line the app did not ask for is ignored, never trusted.
        if (head && wanted.has(head.uid)) heads.push(head);
      }
      return { validity, heads };
    });
  }

  /** One whole message, as the server has it (cut at a size limit). */
  async read(folder: string, uid: number, validity: string): Promise<Buffer> {
    checkFolder(folder);
    if (!Number.isInteger(uid) || uid < 1 || uid > 4_294_967_295)
      throw new MailError("That message is not known.");
    return this.session(async (session) => {
      const now = await this.open(session, folder);
      if (validity && now !== validity)
        throw new MailError(
          "The mailbox changed since it was listed. List the messages again.",
        );
      const fetched = await session.send(
        `UID FETCH ${uid} (UID BODY.PEEK[]<0.${MAX_MESSAGE_BYTES}>)`,
      );
      if (fetched.status !== "OK")
        throw new MailError("The server could not give that message.");
      for (const response of fetched.untagged) {
        const lead = firstText(response);
        if (!/^\* \d+ FETCH\b/i.test(lead)) continue;
        if (!new RegExp(`\\bUID ${uid}\\b`, "i").test(allText(response)))
          continue;
        const literal = response.parts.find(
          (p): p is { literal: Buffer } => "literal" in p,
        );
        if (literal) return literal.literal;
      }
      throw new MailError(
        "That message was not found. It may have been moved.",
      );
    });
  }
}

/** The folder name in one "* LIST (...) "/" name" response, cleaned. */
function listName(response: Response): string | undefined {
  const first = response.parts[0];
  if (!first || !("text" in first) || !/^\* LIST\b/i.test(first.text))
    return undefined;
  const literal = response.parts[1];
  let name: string | undefined;
  if (literal && "literal" in literal)
    name = literal.literal.toString("latin1");
  else {
    const m =
      /^\* LIST \([^)]*\) (?:"(?:[^"\\]|\\.)*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))$/i.exec(
        first.text,
      );
    name = m?.[1]?.replace(/\\(.)/g, "$1") ?? m?.[2];
  }
  if (!name) return undefined;
  const clean = name.replace(/\p{Cc}+/gu, " ").trim();
  return clean
    ? clean.length > 60
      ? `${clean.slice(0, 59)}…`
      : clean
    : undefined;
}
