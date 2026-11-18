/**
 * What every wire shares: the neutral message list the agent works in, the
 * events a turn produces, and the plain-sentence error rules.
 *
 * Rules kept here: a redirect is an error (so a key never follows one), and
 * an error is a short sentence that never carries the key.
 */

import type { Wire } from "../../shared/types";

export interface ToolCall {
  id: string;
  name: string;
  /** The arguments exactly as the model wrote them: a JSON text. */
  arguments: string;
  /** Opaque proof a service wants echoed back with this call (Gemini). */
  signature?: string;
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  signature?: string;
}

/** One picture, base64, as a tool result may carry beside its text. */
export interface ImagePart {
  mediaType: string;
  data: string;
}

/** The neutral message list. Each wire maps it to its own service's shape. */
export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: WireToolCall[] }
  | {
      role: "tool";
      tool_call_id: string;
      content: string;
      /** At most one picture, sent beside the text in the way the wire allows. */
      image?: ImagePart;
    };

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ModelCall {
  baseUrl: string;
  /** How to speak to the service. Missing means "openai". */
  wire?: Wire;
  apiKey?: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface ListInput {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** What one model turn produces: text as it arrives, then any tool calls. */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "calls"; calls: ToolCall[] };

export class ModelError extends Error {
  constructor(
    message: string,
    /** The HTTP status, when the service answered with one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Reads server-sent events as they arrive, whatever way the bytes are split. */
export class SseParser {
  private buffer = "";

  /** Returns the data of every complete event in what has arrived so far. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let end = this.buffer.indexOf("\n");
    while (end !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, "");
      this.buffer = this.buffer.slice(end + 1);
      if (line.startsWith("data:")) out.push(line.slice(5).trimStart());
      end = this.buffer.indexOf("\n");
    }
    return out;
  }
}

/** Takes the key out of a piece of text, if the service echoed it. */
export function withoutKey(text: string, apiKey?: string): string {
  return apiKey ? text.split(apiKey).join("[key]") : text;
}

/**
 * Why a call was turned down. For a bad request the service's own reason is
 * the useful part (a local model's settings, a wrong model name), so a short,
 * single-line copy of it is shown, with the key taken out if it was echoed.
 */
export async function failure(
  response: Response,
  apiKey?: string,
): Promise<ModelError> {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new ModelError(
      "The model refused the key. Check it in Models.",
      status,
    );
  }
  if (status === 404) {
    return new ModelError(
      "The model was not found there. Check the model's name in Models.",
      status,
    );
  }
  if (status === 402) {
    return new ModelError(
      "The account for this key is out of balance.",
      status,
    );
  }
  if (status === 429 || status === 529) {
    return new ModelError(
      "The model is busy or the key is at its limit. Try again in a moment.",
      status,
    );
  }
  const reason =
    status === 400 || status === 422 ? await reasonOf(response, apiKey) : "";
  return new ModelError(
    reason
      ? `The model turned the request down: ${reason}`
      : `The model answered with an error (${status}).`,
    status,
  );
}

export async function reasonOf(
  response: Response,
  apiKey?: string,
): Promise<string> {
  try {
    const body: unknown = JSON.parse((await response.text()).slice(0, 4000));
    const error = (body as { error?: unknown }).error;
    const text =
      typeof error === "string"
        ? error
        : (error as { message?: unknown } | undefined)?.message;
    if (typeof text !== "string") return "";
    const safe = withoutKey(text.replace(/\s+/g, " ").trim(), apiKey);
    return safe.length > 200 ? `${safe.slice(0, 200)}…` : safe;
  } catch {
    return "";
  }
}

export function unreachable(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelError("Stopped.");
  }
  return new ModelError(
    "The model could not be reached. Is it running, and is the address right?",
  );
}

/** Opens a streaming POST. A redirect is an error, and the key stays in headers. */
export async function open(
  call: ModelCall,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  const doFetch = call.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: call.signal,
    });
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) throw await failure(response, call.apiKey);
  if (!response.body) throw new ModelError("The model sent no answer.");
  return response;
}

/** The data of every server-sent event, as it arrives. A stop ends it at once. */
export async function* sseData(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  // open() has already checked there is a body.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      if (signal?.aborted) throw new ModelError("Stopped.");
      const { done, value } = await reader.read();
      if (done) break;
      for (const data of parser.push(decoder.decode(value, { stream: true }))) {
        yield data;
      }
    }
  } catch (error) {
    throw unreachable(error);
  } finally {
    reader.releaseLock();
  }
}

/** Reads a JSON list answer, or says it did not look like a model service. */
export async function listBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ModelError("That address did not answer like a model service.");
  }
}

/** Fetches a model list. A redirect is an error; the key goes in headers only. */
export async function getList(
  input: ListInput,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const doFetch = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 8000),
    });
  } catch {
    throw new ModelError(
      "The model could not be reached. Is it running, and is the address right?",
    );
  }
  if (!response.ok) throw await failure(response, input.apiKey);
  return listBody(response);
}

/** Keeps sane, sorted model ids. */
export function cleanIds(ids: unknown[]): string[] {
  return ids
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && id.length <= 200,
    )
    .slice(0, 500)
    .sort((a, b) => a.localeCompare(b));
}

const NOT_A_SERVICE = "That address did not answer like a model service.";
export function notAService(): ModelError {
  return new ModelError(NOT_A_SERVICE);
}
