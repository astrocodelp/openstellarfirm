/**
 * The one place that talks to a model: the OpenAI-compatible chat completions
 * wire, which Ollama, LM Studio, the hosted vendors and gateways all speak.
 *
 * Rules kept here: the key goes only in the Authorization header, a redirect
 * is an error (so a key never follows one), and an error is a plain sentence
 * that carries no key and nothing the server wrote.
 */

export interface ModelCall {
  baseUrl: string;
  apiKey?: string;
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export class ModelError extends Error {}

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
    return new ModelError("The model refused the key. Check it in Models.");
  }
  if (status === 404) {
    return new ModelError(
      "The model was not found there. Check the model's name in Models.",
    );
  }
  if (status === 402) {
    return new ModelError("The account for this key is out of balance.");
  }
  if (status === 429) {
    return new ModelError(
      "The model is busy or the key is at its limit. Try again in a moment.",
    );
  }
  const reason =
    status === 400 || status === 422 ? await reasonOf(response, apiKey) : "";
  return new ModelError(
    reason
      ? `The model turned the request down: ${reason}`
      : `The model answered with an error (${status}).`,
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
  if (error instanceof Error && error.name === "AbortError")
    return new ModelError("Stopped.");
  return new ModelError(
    "The model could not be reached. Is it running, and is the address right?",
  );
}

/** Streams an answer as pieces of text. */
export async function* streamChat(call: ModelCall): AsyncGenerator<string> {
  const doFetch = call.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${call.baseUrl}/chat/completions`, {
      method: "POST",
      headers: headers(call.apiKey),
      body: JSON.stringify({
        model: call.model,
        messages: call.messages,
        stream: true,
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const data of parser.push(decoder.decode(value, { stream: true }))) {
        if (data === "[DONE]") return;
        const text = deltaText(data);
        if (text) yield text;
      }
    }
  } catch (error) {
    throw unreachable(error);
  } finally {
    reader.releaseLock();
  }
}

function deltaText(data: string): string {
  try {
    const parsed: unknown = JSON.parse(data);
    const choice = (parsed as { choices?: { delta?: { content?: unknown } }[] })
      .choices?.[0];
    const content = choice?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
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
  if (!Array.isArray(rows))
    throw new ModelError("That address did not answer like a model service.");
  return rows
    .map((row) => (row as { id?: unknown }).id)
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && id.length <= 200,
    )
    .slice(0, 500)
    .sort((a, b) => a.localeCompare(b));
}
