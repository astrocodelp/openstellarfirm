import { Duplex } from "node:stream";
import type { ImapDeps } from "./imap";

/**
 * An IMAP server that lives in the test process, for the mail tests. It talks
 * over a pair of in-memory streams, never a socket, and records every command
 * the client sends so a test can check the client only ever looks.
 */

class End extends Duplex {
  peer: End | undefined;
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    this.peer?.push(chunk);
    done();
  }
  override _read(): void {}
  override _final(done: (error?: Error | null) => void): void {
    this.peer?.push(null);
    done();
  }
  override _destroy(
    error: Error | null,
    done: (error?: Error | null) => void,
  ): void {
    this.peer?.push(null);
    done(error);
  }
}

export interface FakeMessage {
  uid: number;
  /** Without "\\Seen" it is unread. */
  flags?: string[];
  date: string;
  raw: string | Buffer;
}

export interface FakeOptions {
  user?: string;
  password?: string;
  folders?: Record<string, FakeMessage[]>;
  validity?: number;
  /** Server bytes are written this many at a time, to split lines and literals. */
  chunk?: number;
  greeting?: string;
  /** What the server says to a refused sign-in. It may echo the password. */
  refusal?: (password: string) => string;
  /** Replaces the answer to a command. Return undefined for the normal answer. */
  respond?: (command: string, tag: string) => string | Buffer | undefined;
  /** When set, a command with this name gets no answer at all. */
  silentOn?: string;
}

export class FakeImap {
  /** Every line the client wrote, with its tag. */
  readonly commands: string[] = [];
  /** Every byte the client wrote. */
  written = "";
  private folder = "";
  private input = "";
  private queue: Promise<void> = Promise.resolve();
  private server: End | undefined;

  constructor(private readonly options: FakeOptions = {}) {}

  private get folders(): Record<string, FakeMessage[]> {
    return (
      this.options.folders ?? {
        INBOX: [],
      }
    );
  }

  /** The client's end of the connection. */
  connect(): Duplex {
    const client = new End();
    const server = new End();
    client.peer = server;
    server.peer = client;
    this.server = server;
    this.input = "";
    this.folder = "";
    server.on("data", (chunk: Buffer) => this.onData(chunk));
    this.emit(this.options.greeting ?? "* OK [CAPABILITY IMAP4rev1] Ready\r\n");
    return client;
  }

  deps(over: Partial<ImapDeps> = {}): ImapDeps {
    return {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      connect: async () => this.connect(),
      now: () => new Date("2026-11-19T12:00:00Z"),
      ...over,
    };
  }

  private emit(data: string | Buffer): void {
    const buffer =
      typeof data === "string" ? Buffer.from(data, "latin1") : data;
    const size = this.options.chunk ?? 0;
    // Bound now: a late answer of an earlier connection never reaches a new one.
    const server = this.server;
    this.queue = this.queue.then(async () => {
      if (!server || server.destroyed) return;
      if (size <= 0) {
        server.write(buffer);
        return;
      }
      for (let at = 0; at < buffer.length; at += size) {
        if (server.destroyed) return;
        server.write(buffer.subarray(at, at + size));
        await new Promise((resolve) => setImmediate(resolve));
      }
    });
  }

  private onData(chunk: Buffer): void {
    this.written += chunk.toString("latin1");
    this.input += chunk.toString("latin1");
    for (;;) {
      const at = this.input.indexOf("\r\n");
      if (at < 0) return;
      const line = this.input.slice(0, at);
      this.input = this.input.slice(at + 2);
      this.commands.push(line);
      this.handle(line);
    }
  }

  private handle(line: string): void {
    const space = line.indexOf(" ");
    const tag = line.slice(0, space);
    const command = line.slice(space + 1);
    const verb = command.split(" ")[0] ?? "";
    if (this.options.silentOn && command.startsWith(this.options.silentOn))
      return;
    const custom = this.options.respond?.(command, tag);
    if (custom !== undefined) {
      this.emit(custom);
      return;
    }
    if (verb === "LOGIN") {
      const m = /^LOGIN "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/.exec(command);
      const user = m?.[1]?.replace(/\\(.)/g, "$1");
      const pass = m?.[2]?.replace(/\\(.)/g, "$1") ?? "";
      if (
        user === (this.options.user ?? "me@example.com") &&
        pass === (this.options.password ?? "app-password")
      )
        this.emit(`${tag} OK Logged in\r\n`);
      else
        this.emit(
          `${tag} NO ${this.options.refusal?.(pass) ?? "[AUTHENTICATIONFAILED] Invalid credentials"}\r\n`,
        );
      return;
    }
    if (verb === "LIST") {
      const names = Object.keys(this.folders);
      let out = "";
      for (const name of names) {
        // One name travels as a literal, as real servers do for odd names.
        out +=
          name === "Receipts & more"
            ? `* LIST (\\HasNoChildren) "/" {${name.length}}\r\n${name}\r\n`
            : `* LIST (\\HasNoChildren) "/" "${name}"\r\n`;
      }
      this.emit(`${out}${tag} OK Done\r\n`);
      return;
    }
    if (verb === "EXAMINE") {
      const name = /^EXAMINE "(.*)"$/.exec(command)?.[1] ?? "";
      const messages = this.folders[name];
      if (!messages) {
        this.emit(`${tag} NO No such folder\r\n`);
        return;
      }
      this.folder = name;
      this.emit(
        `* ${messages.length} EXISTS\r\n* OK [UIDVALIDITY ${this.options.validity ?? 777}] Ok\r\n${tag} OK [READ-ONLY] Done\r\n`,
      );
      return;
    }
    const messages = this.folders[this.folder] ?? [];
    if (command.startsWith("UID SEARCH")) {
      const unseen = command.includes("UNSEEN");
      const hits = messages
        .filter((m) => !unseen || !(m.flags ?? []).includes("\\Seen"))
        .map((m) => m.uid);
      this.emit(`* SEARCH ${hits.join(" ")}\r\n${tag} OK Done\r\n`);
      return;
    }
    if (command.startsWith("UID FETCH")) {
      const uids = /^UID FETCH ([\d,]+) /.exec(command)?.[1]?.split(",") ?? [];
      const wholeMessage = command.includes("BODY.PEEK[]");
      let out: Buffer[] = [];
      for (const word of uids) {
        const found = messages.find((m) => m.uid === Number(word));
        if (!found) continue;
        const raw = Buffer.from(found.raw as string | Buffer);
        const flags = (found.flags ?? []).join(" ");
        let body: Buffer;
        let name: string;
        if (wholeMessage) {
          body = raw;
          name = "BODY[]<0>";
        } else {
          const text = raw.toString("latin1");
          const end = text.search(/\r?\n\r?\n/);
          body = Buffer.from(
            `${text.slice(0, end < 0 ? text.length : end)}\r\n\r\n`,
            "latin1",
          );
          name = "BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE)]";
        }
        out = [
          ...out,
          Buffer.from(
            `* 1 FETCH (UID ${found.uid} FLAGS (${flags}) INTERNALDATE "${found.date}" ${name} {${body.length}}\r\n`,
            "latin1",
          ),
          body,
          Buffer.from(")\r\n"),
        ];
      }
      this.emit(Buffer.concat([...out, Buffer.from(`${tag} OK Done\r\n`)]));
      return;
    }
    if (verb === "LOGOUT") {
      this.emit(`* BYE Bye\r\n${tag} OK Logged out\r\n`);
      return;
    }
    this.emit(`${tag} BAD Unknown command\r\n`);
  }
}

/** A date such as the server writes it, "19-Nov-2026 09:12:00 +0000". */
export function internalDate(iso: string): string {
  const d = new Date(iso);
  const months = [
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
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getUTCDate())}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:00 +0000`;
}
