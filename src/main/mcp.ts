import { SseParser, withoutKey } from "./wires/common";

/**
 * A small client for a remote MCP server over HTTP (the "Streamable HTTP"
 * way): JSON-RPC 2.0, one POST for each message to the one saved address.
 *
 * Everything a server sends is outside text. It is checked for its shape, cut
 * to a size, and never trusted: unknown fields are ignored, a tool whose name
 * or schema does not fit is dropped, and a key is never put in an address, a
 * log or an error. A redirect is an error, so the key never follows one.
 */

export class McpError extends Error {}

/** Newest first. The first is what the client asks for. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const ASKED_VERSION: string = PROTOCOL_VERSIONS[0];

export const MAX_PAGES = 5;
export const MAX_TOOLS = 40;
export const MAX_DESCRIPTION = 300;
export const MAX_SCHEMA_BYTES = 8 * 1024;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_RESULT_CHARS = 16_000;
const DEADLINE_MS = 30_000;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A tool as a server described it, cleaned. */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export interface McpOptions {
  baseUrl: string;
  apiKey?: string;
  /** The app's version, sent as the client's own. */
  appVersion?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** For tests. */
  deadlineMs?: number;
  maxBodyBytes?: number;
}

/** Text with control characters taken out, on one line, cut to a length. */
export function plain(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const one = value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// Words that make a tool a change, whatever the server's own hint says.
const CHANGE_WORDS = new Set(
  (
    "create add new update edit set write put patch post send reply forward " +
    "publish share invite email message notify delete remove destroy drop " +
    "clear archive close cancel move rename merge approve pay buy purchase " +
    "order book transfer refund subscribe charge run execute exec deploy " +
    "upload import"
  ).split(" "),
);

/** The words of a tool's name, split on "_", "-" and capital letters. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function readsLikeChange(name: string): boolean {
  return nameWords(name).some((word) => CHANGE_WORDS.has(word));
}

/**
 * True only when the server says the tool just reads (`readOnlyHint` exactly
 * true) and the tool's name does not read like a change. A server's word alone
 * never makes a tool safe.
 */
export function isReadOnly(name: string, annotations: unknown): boolean {
  if (typeof annotations !== "object" || annotations === null) return false;
  const hint = (annotations as { readOnlyHint?: unknown }).readOnlyHint;
  return hint === true && !readsLikeChange(name);
}

function cleanJson(value: unknown, depth: number): unknown {
  if (depth > 8) return undefined;
  if (typeof value === "string") return plain(value, 300);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => cleanJson(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      // A key named like this would change the object's own type.
      if (key === "__proto__") continue;
      const clean = cleanJson(item, depth + 1);
      if (clean !== undefined) out[plain(key, 100)] = clean;
    }
    return out;
  }
  return undefined;
}

/** An object schema under the size limit, with every text in it cut and cleaned. */
export function cleanSchema(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  if ((value as { type?: unknown }).type !== "object") return null;
  if (JSON.stringify(value).length > MAX_SCHEMA_BYTES) return null;
  const clean = cleanJson(value, 0);
  return clean && typeof clean === "object" && !Array.isArray(clean)
    ? (clean as Record<string, unknown>)
    : null;
}

/** Keeps the tools that fit the rules. Anything that does not is dropped. */
export function cleanTools(raw: unknown): McpTool[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const kept: McpTool[] = [];
  for (const item of raw) {
    if (kept.length >= MAX_TOOLS) break;
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || !TOOL_NAME.test(name) || seen.has(name))
      continue;
    const inputSchema = cleanSchema(record.inputSchema);
    if (!inputSchema) continue;
    seen.add(name);
    kept.push({
      name,
      description: plain(record.description, MAX_DESCRIPTION),
      inputSchema,
      readOnly: isReadOnly(name, record.annotations),
    });
  }
  return kept;
}

/** The text of a tool's answer. Anything that is not text is named, not shown. */
export function resultText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content.slice(0, 50)) {
    if (typeof item !== "object" || item === null) continue;
    const { type, text } = item as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") parts.push(text);
    else if (type === "image")
      parts.push("[an image was returned and left out]");
    else if (type === "audio") parts.push("[audio was returned and left out]");
    else if (type === "resource" || type === "resource_link")
      parts.push("[a file or link was returned and left out]");
    else parts.push("[something that is not text was returned and left out]");
  }
  return parts.join("\n");
}

interface RpcMessage {
  id?: unknown;
  result?: unknown;
  error?: unknown;
}

export class McpClient {
  private sessionId: string | undefined;
  private version: string | undefined;
  private nextId = 1;
  private ready: Promise<void> | undefined;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: McpOptions) {
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private safe(text: string): string {
    return withoutKey(text, this.options.apiKey);
  }

  private fail(text: string): McpError {
    return new McpError(this.safe(text));
  }

  /** Connects, then lists every tool the server offers, page by page. */
  async listTools(): Promise<McpTool[]> {
    const all: McpTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await this.request(
        "tools/list",
        cursor ? { cursor } : undefined,
      );
      const body = (result ?? {}) as { tools?: unknown; nextCursor?: unknown };
      for (const tool of cleanTools(body.tools)) {
        if (all.length >= MAX_TOOLS) break;
        if (seen.has(tool.name)) continue;
        seen.add(tool.name);
        all.push(tool);
      }
      const next =
        typeof body.nextCursor === "string" && body.nextCursor.length <= 1000
          ? body.nextCursor
          : undefined;
      if (!next || next === cursor || all.length >= MAX_TOOLS) break;
      cursor = next;
    }
    return all;
  }

  /** Calls one tool. A result the server marks as a failure is thrown as an error. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.request("tools/call", { name, arguments: args });
    const body = (result ?? {}) as { content?: unknown; isError?: unknown };
    const text = this.safe(resultText(body.content)).slice(0, MAX_RESULT_CHARS);
    if (body.isError === true) {
      throw this.fail(
        text
          ? `The connection reported a problem: ${text}`
          : "That did not work.",
      );
    }
    return text || "(it returned nothing)";
  }

  private connect(): Promise<void> {
    this.ready ??= this.initialize().catch((error) => {
      this.ready = undefined;
      throw error;
    });
    return this.ready;
  }

  private async initialize(): Promise<void> {
    this.sessionId = undefined;
    this.version = undefined;
    const reply = await this.send("initialize", {
      protocolVersion: ASKED_VERSION,
      capabilities: {},
      clientInfo: {
        name: "StellarFirm Open",
        version: this.options.appVersion ?? "0.0.0",
      },
    });
    const agreed = (reply as { protocolVersion?: unknown } | undefined)
      ?.protocolVersion;
    if (
      typeof agreed !== "string" ||
      !(PROTOCOL_VERSIONS as readonly string[]).includes(agreed)
    ) {
      throw this.fail(
        "That address did not answer like a connection this app can use.",
      );
    }
    this.version = agreed;
    await this.notify("notifications/initialized");
  }

  /** One request, with a new session started once if the server forgot ours. */
  private async request(method: string, params?: object): Promise<unknown> {
    await this.connect();
    try {
      return await this.send(method, params);
    } catch (error) {
      if (!(error instanceof SessionLost)) throw error;
      this.ready = undefined;
      await this.connect();
      try {
        return await this.send(method, params);
      } catch (again) {
        if (again instanceof SessionLost)
          throw this.fail("The connection kept losing its session.");
        throw again;
      }
    }
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.version ? { "MCP-Protocol-Version": this.version } : {}),
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      // The key goes in this header only, and only to the saved address.
      ...(this.options.apiKey
        ? { Authorization: `Bearer ${this.options.apiKey}` }
        : {}),
    };
  }

  private async post(body: object): Promise<Response> {
    const timeout = AbortSignal.timeout(this.options.deadlineMs ?? DEADLINE_MS);
    const signal = this.options.signal
      ? AbortSignal.any([timeout, this.options.signal])
      : timeout;
    let response: Response;
    try {
      response = await this.doFetch(this.options.baseUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch (error) {
      throw this.unreachable(error);
    }
    const session = response.headers.get("mcp-session-id");
    if (session && /^[\x21-\x7e]{1,256}$/.test(session))
      this.sessionId = session;
    return response;
  }

  private unreachable(error: unknown): McpError {
    if (error instanceof McpError) return error;
    if (this.options.signal?.aborted) return this.fail("Stopped.");
    if (error instanceof Error && error.name === "TimeoutError")
      return this.fail("The connection did not answer in time.");
    if (error instanceof Error && error.name === "AbortError")
      return this.fail("The connection did not answer in time.");
    return this.fail(
      "The connection could not be reached. Is the address right?",
    );
  }

  private statusError(status: number): McpError {
    if (status === 401 || status === 403)
      return this.fail(
        "The connection refused the key. Check it in Connections.",
      );
    if (status === 404)
      return this.fail("Nothing answered at that address. Check the address.");
    if (status === 429)
      return this.fail("The connection is busy. Try again in a moment.");
    return this.fail(`The connection answered with an error (${status}).`);
  }

  private async notify(method: string): Promise<void> {
    const response = await this.post({ jsonrpc: "2.0", method });
    // Nothing in the answer is wanted: drop it without reading it.
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw this.statusError(response.status);
  }

  private async send(method: string, params?: object): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const sent = this.sessionId;
    const response = await this.post({
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 && sent && method !== "initialize")
        throw new SessionLost();
      throw this.statusError(response.status);
    }
    let message: RpcMessage | undefined;
    try {
      message = await this.reply(response, id);
    } catch (error) {
      throw this.unreachable(error);
    }
    if (!message)
      throw this.fail("The connection did not answer the way it should.");
    if (message.error !== undefined) {
      const text =
        typeof message.error === "object" && message.error !== null
          ? plain((message.error as { message?: unknown }).message, 200)
          : "";
      throw this.fail(
        text
          ? `The connection answered with an error: ${text}`
          : "The connection answered with an error.",
      );
    }
    return message.result;
  }

  /** Reads the answer to one request, as plain JSON or as an event stream. */
  private async reply(
    response: Response,
    id: number,
  ): Promise<RpcMessage | undefined> {
    const max = this.options.maxBodyBytes ?? MAX_BODY_BYTES;
    const type = response.headers.get("content-type") ?? "";
    const body = response.body;
    if (!body) return undefined;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let total = 0;
    try {
      if (type.includes("text/event-stream")) {
        const parser = new SseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return undefined;
          total += value.byteLength;
          if (total > max) throw this.fail(TOO_LARGE);
          for (const data of parser.push(
            decoder.decode(value, { stream: true }),
          )) {
            const found = pick(parse(data), id);
            if (found) return found;
          }
        }
      }
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) throw this.fail(TOO_LARGE);
        text += decoder.decode(value, { stream: true });
      }
      return pick(parse(text), id);
    } finally {
      // Stop reading at once: a server may keep a stream open for ever.
      await reader.cancel().catch(() => undefined);
    }
  }
}

const TOO_LARGE = "The connection sent more than this app will read.";

class SessionLost extends Error {}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The answer carrying this request's id; other messages are ignored. */
function pick(value: unknown, id: number): RpcMessage | undefined {
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as RpcMessage;
    if (message.id === id && ("result" in message || "error" in message))
      return message;
  }
  return undefined;
}
