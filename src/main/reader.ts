import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import {
  BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  protocol,
  type Session,
  session,
} from "electron";
import {
  type PdfText,
  READER_ORIGIN,
  READER_SCHEME,
  type ReaderAnswer,
  type ReaderJob,
  type ReaderReply,
} from "../shared/reading";
import { readerError, readerPath } from "./reader-rules";

/**
 * The main side of the reader: a hidden window that opens PDFs and reads text
 * from pictures, so no untrusted file is ever parsed in this process.
 *
 * - Sandboxed, isolated, no Node, a preload that only hands over a port.
 * - A session of its own, in memory, where every request but the reader's own
 *   files is cancelled, so it can reach no network at all.
 * - Its files come from the app itself, through a scheme only that session
 *   knows, with a strict Content Security Policy.
 * - One at a time, made on first use and closed after a minute idle. Every
 *   file has 60 seconds; a crash or a timeout is a plain line, never a hang.
 */

const PARTITION = "openstellar-reader";
const DEADLINE_MS = 60_000;
const IDLE_MS = 60_000;

/** The reader's own policy, sent with every file it is served. */
export const READER_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'none'",
  "font-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".traineddata": "application/octet-stream",
};

/** Must run before the app is ready: the scheme acts like https for its page. */
export function registerReaderScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: READER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export interface ReaderDeps {
  /** The folder the reader's page and files were built into. */
  dir: string;
  /** The checked bytes of one language for the reader, or undefined. */
  language(code: string): Uint8Array | undefined;
}

export class ReaderError extends Error {}

export class Reader {
  private window: BrowserWindow | undefined;
  private port: MessagePortMain | undefined;
  private ready: Promise<MessagePortMain> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | undefined;
  private nextId = 1;
  private readonly waiting = new Map<
    number,
    { resolve(answer: ReaderAnswer): void; reject(error: Error): void }
  >();
  private sessionSet = false;

  constructor(private readonly deps: ReaderDeps) {}

  private readerSession(): Session {
    const ses = session.fromPartition(PARTITION, { cache: false });
    if (this.sessionSet) return ses;
    this.sessionSet = true;
    // Nothing leaves: every request that is not one of the reader's own files is cancelled.
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith(`${READER_ORIGIN}/`) });
    });
    ses.setPermissionRequestHandler((_c, _p, done) => done(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.protocol.handle(READER_SCHEME, (request) => this.serve(request.url));
    return ses;
  }

  /** Serves one of the reader's own files, or a language it was given. */
  private serve(url: string): Response {
    const path = readerPath(url);
    const headers = {
      "content-security-policy": READER_CSP,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    };
    if (!path) return new Response(null, { status: 404, headers });
    if (path.startsWith("lang/")) {
      const code = path.slice(5, -".traineddata".length);
      const bytes = this.deps.language(code);
      if (!bytes) return new Response(null, { status: 404, headers });
      return new Response(bytes as Uint8Array<ArrayBuffer>, {
        headers: { ...headers, "content-type": TYPES[".traineddata"] ?? "" },
      });
    }
    const file = normalize(join(this.deps.dir, path));
    if (!file.startsWith(this.deps.dir + sep) || !existsSync(file))
      return new Response(null, { status: 404, headers });
    if (!statSync(file).isFile())
      return new Response(null, { status: 404, headers });
    const type = TYPES[extname(file)];
    if (!type) return new Response(null, { status: 404, headers });
    return new Response(new Uint8Array(readFileSync(file)), {
      headers: { ...headers, "content-type": type },
    });
  }

  private open(): Promise<MessagePortMain> {
    if (this.ready) return this.ready;
    this.ready = new Promise<MessagePortMain>((resolve, reject) => {
      const window = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          preload: join(this.deps.dir, "../reader-preload/index.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
          // The session above has to be set up before the window uses it.
          session: this.readerSession(),
        },
      });
      this.window = window;
      const contents = window.webContents;
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event) => event.preventDefault());
      contents.on("will-attach-webview", (event) => event.preventDefault());
      contents.on("render-process-gone", () =>
        this.close("The reader on this computer stopped."),
      );
      contents.once("did-fail-load", () => {
        this.close("The reader on this computer could not start.");
        reject(new ReaderError("The reader on this computer could not start."));
      });
      contents.once("did-finish-load", () => {
        const { port1, port2 } = new MessageChannelMain();
        port1.on("message", (event) => this.reply(event.data as ReaderReply));
        port1.start();
        this.port = port1;
        contents.postMessage("reader:port", null, [port2]);
        resolve(port1);
      });
      window.on("closed", () => {
        if (this.window === window)
          this.close("The reader on this computer stopped.");
      });
      void window.loadURL(`${READER_ORIGIN}/index.html`);
    });
    return this.ready;
  }

  private reply(reply: ReaderReply): void {
    const entry = this.waiting.get(reply?.id);
    if (!entry) return;
    this.waiting.delete(reply.id);
    if (reply.ok) entry.resolve(reply.answer);
    else entry.reject(new ReaderError(readerError(reply.error)));
  }

  /** Closes the reader, and says why to anything still waiting on it. */
  private close(why: string): void {
    const window = this.window;
    this.window = undefined;
    this.port?.close();
    this.port = undefined;
    this.ready = undefined;
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    for (const entry of this.waiting.values())
      entry.reject(new ReaderError(why));
    this.waiting.clear();
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** Runs one job. Jobs run one after another; each has its own deadline. */
  run(job: ReaderJob): Promise<ReaderAnswer> {
    const next = this.queue.then(() => this.runNow(job));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(job: ReaderJob): Promise<ReaderAnswer> {
    if (this.idle) clearTimeout(this.idle);
    this.idle = undefined;
    try {
      const port = await this.open();
      const id = this.nextId++;
      return await new Promise<ReaderAnswer>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.close("Reading that file took too long, so it was stopped.");
        }, DEADLINE_MS);
        this.waiting.set(id, {
          resolve: (answer) => {
            clearTimeout(timer);
            resolve(answer);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        port.postMessage({ id, job });
      });
    } finally {
      this.idle = setTimeout(() => this.close("Closed."), IDLE_MS);
    }
  }

  async pdfPages(bytes: Uint8Array): Promise<number> {
    const answer = await this.run({ op: "pdf-info", bytes });
    if (answer.op !== "pdf-info")
      throw new ReaderError("The reader answered wrongly.");
    return answer.pages;
  }

  async pdfText(
    bytes: Uint8Array,
    ocrPages: number,
    langs: string[],
  ): Promise<PdfText> {
    const answer = await this.run({
      op: "pdf-text",
      bytes,
      ocrPages,
      langs,
      // Leaves time to send the answer back before the deadline.
      budgetMs: DEADLINE_MS - 10_000,
    });
    if (answer.op !== "pdf-text")
      throw new ReaderError("The reader answered wrongly.");
    return answer.result;
  }

  async ocr(
    bytes: Uint8Array,
    mediaType: string,
    langs: string[],
  ): Promise<string> {
    const answer = await this.run({ op: "ocr", bytes, mediaType, langs });
    if (answer.op !== "ocr")
      throw new ReaderError("The reader answered wrongly.");
    return answer.text;
  }

  async toPng(bytes: Uint8Array, mediaType: string): Promise<Uint8Array> {
    const answer = await this.run({ op: "to-png", bytes, mediaType });
    if (answer.op !== "to-png" || !(answer.bytes instanceof Uint8Array))
      throw new ReaderError("The reader answered wrongly.");
    return answer.bytes;
  }

  /** Closes the reader when the app quits. */
  dispose(): void {
    this.close("Closed.");
  }
}
