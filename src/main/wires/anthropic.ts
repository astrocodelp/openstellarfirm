/**
 * Anthropic's Messages API. The key goes only in the `x-api-key` header.
 * The neutral message list is mapped to Anthropic's own shape here: the
 * system prompt becomes `system`, a tool call becomes a `tool_use` block, and
 * its result goes back as a `tool_result` block in the next `user` message.
 */

import type { ModelInfo } from "../../shared/types";
import {
  cleanModels,
  type FilePart,
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
  when,
} from "./common";

const VERSION = "2023-06-01";
/** The Messages API needs a ceiling on the answer. */
const MAX_TOKENS = 8192;

function headers(apiKey?: string): Record<string, string> {
  const base: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": VERSION,
  };
  if (apiKey) base["x-api-key"] = apiKey;
  return base;
}

type Block =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
      title: string;
    }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content:
        | string
        | (
            | { type: "text"; text: string }
            | {
                type: "image";
                source: { type: "base64"; media_type: string; data: string };
              }
          )[];
    };

interface Turn {
  role: "user" | "assistant";
  content: Block[];
}

function inputOf(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** A user message's text, then each file after the line that introduces it. */
function userBlocks(content: string, files: FilePart[] = []): Block[] {
  const blocks: Block[] = [];
  // The service refuses an empty text block.
  if (content.trim() || files.length === 0)
    blocks.push({ type: "text", text: content });
  for (const file of files) {
    blocks.push({ type: "text", text: fileLabel(file) });
    blocks.push(
      file.type === "image"
        ? {
            type: "image",
            source: {
              type: "base64",
              media_type: file.mediaType,
              data: file.data,
            },
          }
        : {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: file.data,
            },
            title: file.name,
          },
    );
  }
  return blocks;
}

/** Maps the neutral list to Anthropic's system text and alternating turns. */
export function toAnthropic(messages: WireMessage[]): {
  system: string;
  turns: Turn[];
} {
  const system: string[] = [];
  const turns: Turn[] = [];
  const push = (role: Turn["role"], blocks: Block[]) => {
    if (blocks.length === 0) return;
    // Consecutive turns of one role are one turn. This also gathers every
    // result of a round of tool calls into the single user message it needs.
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === "tool") {
      push("user", [
        {
          type: "tool_result",
          tool_use_id: message.tool_call_id,
          content: message.image
            ? [
                { type: "text", text: message.content },
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: message.image.mediaType,
                    data: message.image.data,
                  },
                },
              ]
            : message.content,
        },
      ]);
    } else if (message.role === "assistant") {
      const blocks: Block[] = [];
      if (message.content.trim()) {
        blocks.push({ type: "text", text: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: inputOf(call.function.arguments),
        });
      }
      push("assistant", blocks);
    } else if (message.role === "system") {
      system.push(message.content);
    } else {
      // Pictures from a recording come alone; attached files come as files.
      push(
        "user",
        message.images?.length
          ? [
              { type: "text", text: message.content },
              ...(message.images ?? []).map(
                (image): Block => ({
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: image.mediaType,
                    data: image.data,
                  },
                }),
              ),
            ]
          : userBlocks(message.content, message.files),
      );
    }
  }
  // The conversation has to open with the person.
  while (turns[0]?.role === "assistant") turns.shift();
  return { system: system.join("\n\n"), turns };
}

interface StreamEvent {
  type?: unknown;
  index?: unknown;
  content_block?: { type?: unknown; id?: unknown; name?: unknown };
  delta?: { type?: unknown; text?: unknown; partial_json?: unknown };
  error?: { type?: unknown };
}

function eventOf(data: string): StreamEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object"
      ? (parsed as StreamEvent)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Streams one turn. Tool calls are joined from their pieces and yielded last. */
export async function* streamAnthropic(
  call: ModelCall,
): AsyncGenerator<TurnEvent> {
  const tools = call.tools ?? [];
  const { system, turns } = toAnthropic(call.messages);
  const response = await open(
    call,
    `${call.baseUrl}/messages`,
    headers(call.apiKey),
    {
      model: call.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      ...(system ? { system } : {}),
      messages: turns,
      ...(tools.length > 0
        ? {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    },
  );

  const uses = new Map<number, ToolCall>();
  const finish = (): TurnEvent | undefined => {
    const ready = [...uses.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, value]) => ({
        ...value,
        id: value.id || `call_${index}`,
        arguments: value.arguments || "{}",
      }))
      .filter((value) => value.name);
    return ready.length > 0 ? { type: "calls", calls: ready } : undefined;
  };

  for await (const data of sseData(response, call.signal)) {
    const event = eventOf(data);
    if (!event) continue;
    const index = typeof event.index === "number" ? event.index : uses.size;
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block?.type === "tool_use") {
          uses.set(index, {
            id: typeof block.id === "string" ? block.id : "",
            name: typeof block.name === "string" ? block.name : "",
            arguments: "",
          });
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          if (delta.text) yield { type: "text", text: delta.text };
        } else if (
          delta?.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          const current = uses.get(index);
          if (current) current.arguments += delta.partial_json;
        }
        break;
      }
      case "message_stop": {
        const last = finish();
        if (last) yield last;
        return;
      }
      case "error":
        throw new ModelError(
          event.error?.type === "overloaded_error"
            ? "The model is busy or the key is at its limit. Try again in a moment."
            : "The model stopped with an error.",
        );
      default:
        break;
    }
  }
  const last = finish();
  if (last) yield last;
}

/** Lists the models Anthropic serves to this key. */
export async function listAnthropic(input: ListInput): Promise<ModelInfo[]> {
  // The list is paged at 20 unless asked for more. The query is fixed text.
  const body = await getList(
    input,
    `${input.baseUrl}/models?limit=1000`,
    headers(input.apiKey),
  );
  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) throw notAService();
  // Each row has "id", "display_name" and "created_at" (RFC 3339).
  return cleanModels(
    rows.map((row) => {
      const r = row as {
        id?: unknown;
        display_name?: unknown;
        created_at?: unknown;
      };
      return {
        id: r.id as string,
        name: typeof r.display_name === "string" ? r.display_name : undefined,
        created: when(r.created_at),
      };
    }),
  );
}
