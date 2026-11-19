/**
 * Google's Gemini API (`streamGenerateContent`). The key goes only in the
 * `x-goog-api-key` header, never in the address. The neutral message list is
 * mapped to Gemini's own shape here: roles are `user` and `model`, the system
 * prompt is `systemInstruction`, a tool call is a `functionCall` part, and its
 * result goes back as a `functionResponse` part in a `user` content.
 *
 * Gemini gives a call no id, so one is made here. Newer models also attach a
 * `thoughtSignature` to a call; it is kept as the call's signature and sent
 * back unchanged on the same part.
 */

import { randomUUID } from "node:crypto";
import {
  cleanIds,
  fileLabel,
  getList,
  type ListInput,
  type ModelCall,
  ModelError,
  notAService,
  open,
  sseData,
  type ToolCall,
  type TurnEvent,
  type WireMessage,
} from "./common";

const MODEL_ID = /^[A-Za-z0-9._-]+$/;

function headers(apiKey?: string): Record<string, string> {
  const base: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) base["x-goog-api-key"] = apiKey;
  return base;
}

/** A model id goes into the address path, so only plain characters pass. */
export function checkGeminiModel(model: string): string {
  if (!MODEL_ID.test(model) || model.length > 200) {
    throw new ModelError(
      "That model name has characters Gemini does not take. Pick one from the list.",
    );
  }
  return model;
}

type Part =
  | { text: string }
  | {
      functionCall: { name: string; args: Record<string, unknown> };
      thoughtSignature?: string;
    }
  | {
      functionResponse: { name: string; response: Record<string, unknown> };
    }
  | { inlineData: { mimeType: string; data: string } };

interface Content {
  role: "user" | "model";
  parts: Part[];
}

function argsOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Maps the neutral list to Gemini's system text and its user and model turns. */
export function toGemini(messages: WireMessage[]): {
  system: string;
  contents: Content[];
} {
  const system: string[] = [];
  const contents: Content[] = [];
  /** A call's name, by its id, since a result has to say which function it is. */
  const names = new Map<string, string>();
  const push = (role: Content["role"], parts: Part[]) => {
    if (parts.length === 0) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  /** Pictures wait until every result of the round is in, then follow them. */
  const pictures: Part[] = [];
  const flush = () => {
    if (pictures.length > 0) push("user", pictures.splice(0));
  };
  for (const message of messages) {
    if (message.role !== "tool") flush();
    if (message.role === "tool") {
      push("user", [
        {
          functionResponse: {
            name: names.get(message.tool_call_id) ?? "tool",
            response: { result: message.content },
          },
        },
      ]);
      if (message.image) {
        pictures.push({
          inlineData: {
            mimeType: message.image.mediaType,
            data: message.image.data,
          },
        });
      }
    } else if (message.role === "assistant") {
      const parts: Part[] = [];
      if (message.content.trim()) parts.push({ text: message.content });
      for (const call of message.tool_calls ?? []) {
        names.set(call.id, call.function.name);
        parts.push({
          functionCall: {
            name: call.function.name,
            args: argsOf(call.function.arguments),
          },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
      }
      push("model", parts);
    } else if (message.role === "system") {
      system.push(message.content);
    } else {
      const parts: Part[] = [];
      if (message.content.trim() || !message.files?.length)
        parts.push({ text: message.content });
      for (const file of message.files ?? []) {
        parts.push({ text: fileLabel(file) });
        parts.push({
          inlineData: {
            mimeType: file.type === "pdf" ? "application/pdf" : file.mediaType,
            data: file.data,
          },
        });
      }
      push("user", parts);
    }
  }
  flush();
  // The conversation has to open with the person.
  while (contents[0]?.role === "model") contents.shift();
  return { system: system.join("\n\n"), contents };
}

/** Gemini takes a subset of JSON Schema, so keys it does not know are left out. */
function schemaOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schemaOf);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = schemaOf(inner);
  }
  return out;
}

function declaration(tool: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}) {
  const properties = (tool.parameters as { properties?: unknown }).properties;
  const hasParameters =
    properties && typeof properties === "object"
      ? Object.keys(properties).length > 0
      : false;
  return {
    name: tool.name,
    description: tool.description,
    // A function with no arguments has to leave the schema out.
    ...(hasParameters ? { parameters: schemaOf(tool.parameters) } : {}),
  };
}

interface Chunk {
  candidates?: {
    content?: {
      parts?: {
        text?: unknown;
        thought?: unknown;
        thoughtSignature?: unknown;
        functionCall?: { name?: unknown; args?: unknown };
      }[];
    };
  }[];
  promptFeedback?: { blockReason?: unknown };
  error?: unknown;
}

function chunkOf(data: string): Chunk | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as Chunk) : undefined;
  } catch {
    return undefined;
  }
}

/** Streams one turn. Each chunk is a whole piece of the answer; calls come last. */
export async function* streamGemini(
  call: ModelCall,
): AsyncGenerator<TurnEvent> {
  const model = checkGeminiModel(call.model);
  const tools = call.tools ?? [];
  const { system, contents } = toGemini(call.messages);
  const response = await open(
    call,
    // `alt=sse` is fixed text the code adds. The key is never in the address.
    `${call.baseUrl}/models/${model}:streamGenerateContent?alt=sse`,
    headers(call.apiKey),
    {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      ...(tools.length > 0
        ? { tools: [{ functionDeclarations: tools.map(declaration) }] }
        : {}),
    },
  ).catch(async (error: unknown) => {
    // Google answers a key it does not know with a 400, not a 401.
    if (
      error instanceof ModelError &&
      error.status === 400 &&
      /api key/i.test(error.message)
    ) {
      throw new ModelError(
        "The model refused the key. Check it in Models.",
        401,
      );
    }
    throw error;
  });

  const calls: ToolCall[] = [];
  for await (const data of sseData(response, call.signal)) {
    const chunk = chunkOf(data);
    if (!chunk) continue;
    if (chunk.error) {
      throw new ModelError("The model stopped with an error.");
    }
    if (chunk.promptFeedback?.blockReason) {
      throw new ModelError("The model would not answer that request.");
    }
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (part.functionCall && typeof part.functionCall.name === "string") {
        calls.push({
          id: `gemini_${randomUUID()}`,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
          ...(typeof part.thoughtSignature === "string" && part.thoughtSignature
            ? { signature: part.thoughtSignature }
            : {}),
        });
      } else if (
        typeof part.text === "string" &&
        part.text &&
        part.thought !== true
      ) {
        yield { type: "text", text: part.text };
      }
    }
  }
  if (calls.length > 0) yield { type: "calls", calls };
}

/** Lists the models this key may use to answer, by their plain ids. */
export async function listGemini(input: ListInput): Promise<string[]> {
  // The list is paged at 50 unless asked for more. The query is fixed text.
  const body = await getList(
    input,
    `${input.baseUrl}/models?pageSize=1000`,
    headers(input.apiKey),
  );
  const rows = (body as { models?: unknown }).models;
  if (!Array.isArray(rows)) throw notAService();
  return cleanIds(
    rows.map((row) => {
      const { name, supportedGenerationMethods } = row as {
        name?: unknown;
        supportedGenerationMethods?: unknown;
      };
      if (
        typeof name !== "string" ||
        !Array.isArray(supportedGenerationMethods) ||
        !supportedGenerationMethods.includes("generateContent")
      ) {
        return undefined;
      }
      const id = name.replace(/^models\//, "");
      return MODEL_ID.test(id) ? id : undefined;
    }),
  );
}
