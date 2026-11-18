/**
 * The one place that talks to a model. It picks the wire a source speaks (the
 * OpenAI-compatible chat completions that Ollama, LM Studio, hosted vendors
 * and gateways use, or the native Anthropic or Gemini wire) and keeps the
 * same turn events for all of them.
 *
 * Rules kept in every wire: the key goes only in a request header, a redirect
 * is an error (so a key never follows one), and an error is a plain sentence
 * that never carries the key.
 */

import type { Wire } from "../shared/types";
import { listAnthropic, streamAnthropic } from "./wires/anthropic";
import type {
  ListInput,
  ModelCall,
  ToolCall,
  TurnEvent,
  WireMessage,
  WireToolCall,
} from "./wires/common";
import { listGemini, streamGemini } from "./wires/gemini";
import { listOpenAi, streamOpenAi } from "./wires/openai";

export {
  type ImagePart,
  type ModelCall,
  ModelError,
  SseParser,
  type ToolCall,
  type ToolSpec,
  type TurnEvent,
  type WireMessage,
} from "./wires/common";

/** An assistant turn that called tools, in the shape the agent keeps. */
export function assistantTurn(text: string, calls: ToolCall[]): WireMessage {
  return {
    role: "assistant",
    content: text,
    tool_calls: calls.map(
      (call): WireToolCall => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
        ...(call.signature ? { signature: call.signature } : {}),
      }),
    ),
  };
}

/** Streams one model turn on the wire the call names (OpenAI-style if none). */
export function streamTurn(call: ModelCall): AsyncGenerator<TurnEvent> {
  const wire: Wire = call.wire ?? "openai";
  if (wire === "anthropic") return streamAnthropic(call);
  if (wire === "gemini") return streamGemini(call);
  return streamOpenAi(call);
}

/** Lists the models an address serves. Also the way a source is checked. */
export function listModels(
  input: ListInput & { wire?: Wire },
): Promise<string[]> {
  if (input.wire === "anthropic") return listAnthropic(input);
  if (input.wire === "gemini") return listGemini(input);
  return listOpenAi(input);
}
