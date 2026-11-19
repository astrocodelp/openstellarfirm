import { describe, expect, it } from "vitest";
import { resolveAddress } from "../shared/address";
import { PRESETS, presetOf } from "../shared/catalog";
import type { PresetId } from "../shared/types";
import { listModelInfo } from "./models";
import { modelsOf } from "./source-models";
import { MAX_LISTED } from "./wires/common";

/**
 * Model lists shaped like each service's own documented answer. No test here
 * touches the network: every answer is a fixture, and every request is kept
 * so its address and headers can be checked.
 */

interface Seen {
  url: string;
  headers: Record<string, string>;
  redirect?: RequestRedirect;
}

function serve(body: unknown, status = 200) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    seen.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    });
    return Response.json(body, { status });
  };
  return { seen, fetchImpl };
}

function list(id: PresetId, body: unknown, part = "") {
  const preset = presetOf(id);
  const baseUrl = resolveAddress(id, { part, baseUrl: "" });
  const served = serve(body);
  const result = modelsOf(preset, baseUrl, "sk-test", {
    fetchImpl: served.fetchImpl,
  });
  return { result, seen: served.seen };
}

describe("every preset gives the person a list to pick from", () => {
  it("asks the service when it has a list, and suggests ids when it has none", () => {
    for (const preset of PRESETS) {
      const suggests = (preset.suggested?.length ?? 0) > 0;
      expect(preset.lists || suggests, preset.id).toBe(true);
      // A service is never both asked and given made-up names.
      expect(preset.lists && suggests, preset.id).toBe(false);
    }
  });
});

describe("Ironlane", () => {
  // docs: GET /v1/models lists the models the key can call, ids only, with
  // "object", "created" (Unix seconds) and "owned_by": "ironlane".
  const body = {
    object: "list",
    data: [
      {
        id: "openai/gpt-4o-mini",
        object: "model",
        created: 1730000000,
        owned_by: "ironlane",
      },
      {
        id: "anthropic/claude-sonnet-5-5",
        object: "model",
        created: 1790000000,
        owned_by: "ironlane",
      },
    ],
  };

  it("asks api.ironlane.ai/v1/models with the key as a bearer token", async () => {
    const { result, seen } = list("ironlane", body);
    const found = await result;
    expect(seen[0]?.url).toBe("https://api.ironlane.ai/v1/models");
    expect(seen[0]?.headers.authorization).toBe("Bearer sk-test");
    expect(seen[0]?.redirect).toBe("error");
    expect(found.from).toBe("listed");
    expect(found.models).toEqual([
      { id: "anthropic/claude-sonnet-5-5", created: 1790000000000 },
      { id: "openai/gpt-4o-mini", created: 1730000000000 },
    ]);
  });
});

describe("OrcaRouter", () => {
  // docs: context_length, max_completion_tokens and architecture appear only
  // when an administrator filled them in.
  const body = {
    object: "list",
    data: [
      {
        id: "openai/gpt-4o-mini",
        object: "model",
        created: 1721260800,
        owned_by: "openai",
        supported_endpoint_types: ["openai"],
        context_length: 128000,
        max_completion_tokens: 16384,
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
      },
      { id: "deepseek/deepseek-v4.1-flash-1017", object: "model" },
    ],
  };

  it("reads the window and pictures where they are given", async () => {
    const { result, seen } = list("orcarouter", body);
    const found = await result;
    expect(seen[0]?.url).toBe("https://api.orcarouter.ai/v1/models");
    expect(found.models).toEqual([
      { id: "deepseek/deepseek-v4.1-flash-1017" },
      {
        id: "openai/gpt-4o-mini",
        context: 128000,
        pictures: true,
        created: 1721260800000,
      },
    ]);
  });
});

describe("LLM API", () => {
  // The catalog's rows carry a name, a kind, the context and what each takes.
  const body = {
    data: [
      {
        id: "MiniMax-M3.1-Flash",
        name: "MiniMax-M3.1-Flash",
        kind: "chat",
        created: 1792368000,
        context_length: 1000000,
        supported_parameters: ["tools", "reasoning"],
        architecture: {
          input_modalities: ["text", "image", "video"],
          output_modalities: ["text"],
        },
      },
      { id: "text-embed-4", name: "Text Embed 4", kind: "embedding" },
      { id: "voice-1", name: "Voice", kind: "tts" },
      {
        id: "glm-5.3",
        name: "GLM 5.3",
        kind: "chat",
        context_length: 200000,
        supported_parameters: ["tools"],
        architecture: { input_modalities: ["text"] },
      },
    ],
  };

  it("keeps the chat models, with their names, windows, tools and pictures", async () => {
    const { result, seen } = list("llmapi", body);
    const found = await result;
    expect(seen[0]?.url).toBe("https://api.llmapi.ai/v1/models");
    expect(found.models).toEqual([
      {
        id: "glm-5.3",
        name: "GLM 5.3",
        context: 200000,
        tools: true,
      },
      {
        id: "MiniMax-M3.1-Flash",
        context: 1000000,
        pictures: true,
        tools: true,
        created: 1792368000000,
      },
    ]);
  });
});

describe("Azure OpenAI", () => {
  // The v1 API's listModels: GET {endpoint}/openai/v1/models, the key in an
  // api-key header, an OpenAI-shaped list of the models the resource can use.
  const body = {
    object: "list",
    data: [
      { id: "gpt-4.1-nano", object: "model", created: 1744329600 },
      { id: "MAI-DS-R1", object: "model", created: 1745020800 },
    ],
  };

  it("asks the resource's v1 address with the key in api-key, never Authorization", async () => {
    const { result, seen } = list("azure", body, "my-resource");
    const found = await result;
    expect(seen[0]?.url).toBe(
      "https://my-resource.openai.azure.com/openai/v1/models",
    );
    expect(seen[0]?.headers["api-key"]).toBe("sk-test");
    expect(seen[0]?.headers.authorization).toBeUndefined();
    expect(found.models.map((m) => m.id)).toEqual([
      "gpt-4.1-nano",
      "MAI-DS-R1",
    ]);
    // The list holds models, not deployments: the form says so.
    expect(presetOf("azure").deployments).toBe(true);
  });
});

describe("Amazon Bedrock", () => {
  it("has no list to ask on bedrock-runtime, so it suggests ids and sends nothing", async () => {
    const preset = presetOf("bedrock");
    expect(preset.lists).toBe(false);
    const served = serve({ data: [] });
    const found = await modelsOf(
      preset,
      resolveAddress("bedrock", { part: "eu-west-1" }),
      "sk-test",
      { fetchImpl: served.fetchImpl },
    );
    expect(served.seen).toEqual([]);
    expect(found.from).toBe("suggested");
    expect(found.models.map((m) => m.id)).toContain("openai.gpt-oss-120b-1:0");
    for (const model of found.models) expect(model.id).toMatch(/^[a-z]+\./);
  });
});

describe("the shapes other services give", () => {
  it("reads a bare array, Together AI's display_name, and leaves out what is not chat", async () => {
    const { fetchImpl } = serve([
      {
        id: "meta-llama/Llama-4-Scout",
        display_name: "Llama 4 Scout",
        type: "chat",
        context_length: 1048576,
        created: 1743897600,
      },
      { id: "BAAI/bge-large", type: "embedding" },
      { id: "Salesforce/rerank", type: "rerank" },
    ]);
    const models = await listModelInfo({ baseUrl: "stub://t/v1", fetchImpl });
    expect(models).toEqual([
      {
        id: "meta-llama/Llama-4-Scout",
        name: "Llama 4 Scout",
        context: 1048576,
        created: 1743897600000,
      },
    ]);
  });

  it("reads Mistral's capabilities and window, and leaves out a model that cannot chat", async () => {
    const { fetchImpl } = serve({
      object: "list",
      data: [
        {
          id: "mistral-medium-3.5",
          capabilities: {
            completion_chat: true,
            function_calling: true,
            vision: true,
          },
          max_context_length: 131072,
          created: 1756746619,
        },
        {
          id: "mistral-embed",
          capabilities: { completion_chat: false },
          max_context_length: 8192,
        },
      ],
    });
    const models = await listModelInfo({ baseUrl: "stub://m/v1", fetchImpl });
    expect(models).toEqual([
      {
        id: "mistral-medium-3.5",
        context: 131072,
        pictures: true,
        tools: true,
        created: 1756746619000,
      },
    ]);
  });

  it("reads Groq's context_window", async () => {
    const { fetchImpl } = serve({
      data: [{ id: "llama-4-scout", context_window: 131072 }],
    });
    const models = await listModelInfo({ baseUrl: "stub://g/v1", fetchImpl });
    expect(models).toEqual([{ id: "llama-4-scout", context: 131072 }]);
  });

  it("reads Anthropic's display_name and created_at", async () => {
    const { fetchImpl } = serve({
      data: [
        {
          id: "claude-sonnet-5-5",
          display_name: "Claude Sonnet 5.5",
          created_at: "2026-09-30T00:00:00Z",
          type: "model",
        },
      ],
    });
    const models = await listModelInfo({
      baseUrl: "stub://a/v1",
      wire: "anthropic",
      fetchImpl,
    });
    expect(models).toEqual([
      {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        created: Date.parse("2026-09-30T00:00:00Z"),
      },
    ]);
  });

  it("reads Gemini's displayName and inputTokenLimit", async () => {
    const { fetchImpl } = serve({
      models: [
        {
          name: "models/gemini-3.8-flash",
          displayName: "Gemini 3.8 Flash",
          inputTokenLimit: 1048576,
          supportedGenerationMethods: ["generateContent", "countTokens"],
        },
        {
          name: "models/text-embedding-005",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    const models = await listModelInfo({
      baseUrl: "stub://g/v1beta",
      wire: "gemini",
      fetchImpl,
    });
    expect(models).toEqual([
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", context: 1048576 },
    ]);
  });
});

describe("a list is read strictly", () => {
  it("drops bad ids and nonsense facts, keeps each id once, and caps the count", async () => {
    const rows: unknown[] = [
      { id: "" },
      { id: 42 },
      { id: "line\nbreak" },
      { id: "x".repeat(201) },
      { id: "fine", name: "x".repeat(121), context_length: -5, created: 9e15 },
      { id: "fine", name: "Second copy" },
      { id: "huge", context_length: 1e12 },
      "not a row",
      null,
    ];
    for (let i = 0; i < MAX_LISTED + 50; i++) rows.push({ id: `m-${i}` });
    const { fetchImpl } = serve({ data: rows });
    const models = await listModelInfo({ baseUrl: "stub://s/v1", fetchImpl });
    expect(models.length).toBe(MAX_LISTED);
    expect(models.find((m) => m.id === "fine")).toEqual({ id: "fine" });
    expect(models.find((m) => m.id === "huge")).toEqual({ id: "huge" });
    expect(models.some((m) => m.id.includes("\n"))).toBe(false);
  });

  it("refuses an answer that is not a list", async () => {
    const { fetchImpl } = serve({ models: "nope" });
    await expect(
      listModelInfo({ baseUrl: "stub://s/v1", fetchImpl }),
    ).rejects.toThrow(/did not answer like a model service/);
  });
});
