/**
 * The one place that talks to a model: the OpenAI-compatible chat completions
 * wire, which Ollama, LM Studio, the hosted vendors and gateways all speak.
 *
 * Rules kept here: the key goes only in the Authorization header, a redirect
 * is an error (so a key never follows one), and an error is a plain sentence
 * that never carries the key.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** The arguments exactly as the model wrote them: a JSON text. */
  arguments: string;
}

interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** A JSON Schema object for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ModelCall {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: WireMessage[];
  tools?: ToolSpec[];
  signal?: AbortSignal;
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

/** An assistant turn that called tools, in the shape the wire wants back. */
export function assistantTurn(text: string, calls: ToolCall[]): WireMessage {
  return {
    role: "assistant",
    content: text,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    })),
  };
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

function headers(apiKey?: string): Record<string, string> {
  const base: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) base.authorization = `Bearer ${apiKey}`;
  return base;
}

/**
 * Why a call was turned down. For a bad request the service's own reason is
 * the useful part (a local model's settings, a wrong model name), so a short,
 * single-line copy of it is shown, with the key taken out if it was echoed.
 */
async function failure(
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
  if (status === 429) {
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

async function reasonOf(response: Response, apiKey?: string): Promise<string> {
  try {
    const body: unknown = JSON.parse((await response.text()).slice(0, 4000));
    const error = (body as { error?: unknown }).error;
    const text =
      typeof error === "string"
        ? error
        : (error as { message?: unknown } | undefined)?.message;
    if (typeof text !== "string") return "";
    const clean = text.replace(/\s+/g, " ").trim();
    const safe = apiKey ? clean.split(apiKey).join("[key]") : clean;
    return safe.length > 200 ? `${safe.slice(0, 200)}…` : safe;
  } catch {
    return "";
  }
}

function unreachable(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ModelError("Stopped.");
  }
  return new ModelError(
    "The model could not be reached. Is it running, and is the address right?",
  );
}

interface Delta {
  content?: unknown;
  tool_calls?: {
    index?: unknown;
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  }[];
}

function deltaOf(data: string): Delta | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    return (parsed as { choices?: { delta?: Delta }[] }).choices?.[0]?.delta;
  } catch {
    return undefined;
  }
}

/**
 * Streams one model turn. Text is yielded as it arrives. Tool calls arrive in
 * pieces keyed by their index, so they are joined and yielded once, at the end.
 */
export async function* streamTurn(call: ModelCall): AsyncGenerator<TurnEvent> {
  const doFetch = call.fetchImpl ?? fetch;
  const tools = call.tools ?? [];
  let response: Response;
  try {
    response = await doFetch(`${call.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(call.apiKey),
      body: JSON.stringify({
        model: call.model,
        messages: call.messages,
        stream: true,
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                type: "function",
                function: tool,
              })),
            }
          : {}),
      }),
      redirect: "error",
      signal: call.signal,
    });
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) throw await failure(response, call.apiKey);
  if (!response.body) throw new ModelError("The model sent no answer.");

  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const calls = new Map<number, ToolCall>();
  const finish = (): TurnEvent | undefined => {
    const ready = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => ({ ...value, id: value.id || `call_${index}` }))
      .filter((value) => value.name);
    return ready.length > 0 ? { type: "calls", calls: ready } : undefined;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const data of parser.push(decoder.decode(value, { stream: true }))) {
        if (data === "[DONE]") {
          const last = finish();
          if (last) yield last;
          return;
        }
        const delta = deltaOf(data);
        if (!delta) continue;
        if (typeof delta.content === "string" && delta.content) {
          yield { type: "text", text: delta.content };
        }
        for (const piece of delta.tool_calls ?? []) {
          const index =
            typeof piece.index === "number" ? piece.index : calls.size;
          const current = calls.get(index) ?? {
            id: "",
            name: "",
            arguments: "",
          };
          if (typeof piece.id === "string") current.id = piece.id;
          if (typeof piece.function?.name === "string") {
            current.name += piece.function.name;
          }
          if (typeof piece.function?.arguments === "string") {
            current.arguments += piece.function.arguments;
          }
          calls.set(index, current);
        }
      }
    }
  } catch (error) {
    throw unreachable(error);
  } finally {
    reader.releaseLock();
  }
  const last = finish();
  if (last) yield last;
}

/** Lists the models an address serves. Also the way a source is checked. */
export async function listModels(input: {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const doFetch = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${input.baseUrl}/models`, {
      headers: headers(input.apiKey),
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 8000),
    });
  } catch {
    throw new ModelError(
      "The model could not be reached. Is it running, and is the address right?",
    );
  }
  if (!response.ok) throw await failure(response, input.apiKey);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ModelError("That address did not answer like a model service.");
  }
  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) {
    throw new ModelError("That address did not answer like a model service.");
  }
  return rows
    .map((row) => (row as { id?: unknown }).id)
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && id.length <= 200,
    )
    .slice(0, 500)
    .sort((a, b) => a.localeCompare(b));
}
