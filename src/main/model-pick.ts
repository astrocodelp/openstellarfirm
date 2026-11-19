import type { ModelInfo, ModelPick } from "../shared/types";

/**
 * Picks the model a first run starts with, from what a program on this
 * computer says about its models: one that can hold a conversation and use
 * tools, then one that can also read pictures, then the newest. A model that
 * only makes embeddings is never picked. When the program says nothing about
 * its models, the first one that does not look like an embedding model wins.
 *
 * Only Ollama's and LM Studio's own addresses on this computer are asked, and
 * only for their lists: nothing is sent about the person.
 */

interface Facts {
  name: string;
  /** "completion", "tools", "vision", "embedding" and the like. */
  can: Set<string>;
  /** When it was put on this computer, in milliseconds; 0 when not known. */
  at: number;
}

/** How many models are asked about, at most, so a long list stays quick. */
const MAX_ASKED = 24;

function looksLikeEmbedding(name: string): boolean {
  return /embed|bge-|minilm|e5-|nomic-embed|rerank/i.test(name);
}

/** The program's own address, without the "/v1" its chat answers on. */
function rootOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

async function json(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

async function ollamaFacts(
  root: string,
  names: string[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Facts[]> {
  const tags = (await json(fetchImpl, `${root}/api/tags`, {}, timeoutMs)) as {
    models?: { name?: unknown; model?: unknown; modified_at?: unknown }[];
  };
  const when = new Map<string, number>();
  for (const row of tags.models ?? []) {
    const name =
      typeof row.name === "string"
        ? row.name
        : typeof row.model === "string"
          ? row.model
          : "";
    const at =
      typeof row.modified_at === "string" ? Date.parse(row.modified_at) : 0;
    if (name) when.set(name, Number.isNaN(at) ? 0 : at);
  }
  return Promise.all(
    names.slice(0, MAX_ASKED).map(async (name) => {
      let can = new Set<string>();
      try {
        const shown = (await json(
          fetchImpl,
          `${root}/api/show`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: name }),
          },
          timeoutMs,
        )) as { capabilities?: unknown };
        if (Array.isArray(shown.capabilities))
          can = new Set(
            shown.capabilities.filter(
              (c): c is string => typeof c === "string",
            ),
          );
      } catch {
        // An older Ollama says nothing about what a model can do.
      }
      return { name, can, at: when.get(name) ?? 0 };
    }),
  );
}

async function lmStudioFacts(
  root: string,
  names: string[],
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Facts[]> {
  const body = (await json(
    fetchImpl,
    `${root}/api/v0/models`,
    {},
    timeoutMs,
  )) as {
    data?: { id?: unknown; type?: unknown; capabilities?: unknown }[];
  };
  const byId = new Map<string, Set<string>>();
  for (const row of body.data ?? []) {
    if (typeof row.id !== "string") continue;
    const can = new Set<string>();
    if (row.type === "llm" || row.type === "vlm") can.add("completion");
    if (row.type === "vlm") can.add("vision");
    if (row.type === "embeddings") can.add("embedding");
    if (
      Array.isArray(row.capabilities) &&
      row.capabilities.includes("tool_use")
    )
      can.add("tools");
    byId.set(row.id, can);
  }
  return names.map((name) => ({
    name,
    can: byId.get(name) ?? new Set(),
    at: 0,
  }));
}

function score(facts: Facts): number {
  if (facts.can.size === 0) return looksLikeEmbedding(facts.name) ? -1 : 0;
  if (!facts.can.has("completion")) return -1;
  return (
    1 + (facts.can.has("tools") ? 4 : 0) + (facts.can.has("vision") ? 2 : 0)
  );
}

function reason(facts: Facts, newest: boolean): string {
  const can: string[] = [];
  if (facts.can.has("tools")) can.push("use tools");
  if (facts.can.has("vision")) can.push("read pictures");
  const parts: string[] = [];
  if (can.length > 0) parts.push(`it can ${can.join(" and ")}`);
  if (newest) parts.push("it is the newest here");
  return parts.length > 0
    ? `${parts.join(", and ")}.`
    : "it is the first model listed.";
}

/** The best of the listed models for a first run, and why, or undefined. */
export function bestModel(list: Facts[]): ModelPick | undefined {
  const usable = list.filter((f) => score(f) >= 0);
  if (usable.length === 0) return undefined;
  const ranked = [...usable].sort(
    (a, b) =>
      score(b) - score(a) || b.at - a.at || a.name.localeCompare(b.name),
  );
  const best = ranked[0];
  if (!best) return undefined;
  const newest =
    best.at > 0 && usable.every((f) => f === best || f.at < best.at);
  const known = best.can.size > 0 || newest;
  return {
    model: best.name,
    reason: known ? reason(best, newest) : "it is the first model listed.",
  };
}

interface LocalOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * What the program at `baseUrl` says about each of `names`. Asking it can
 * fail; then nothing is known but the names.
 */
async function localFacts(
  preset: "ollama" | "lmstudio",
  baseUrl: string,
  names: string[],
  options: LocalOptions = {},
): Promise<Facts[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1500;
  const root = rootOf(baseUrl);
  try {
    return preset === "ollama"
      ? await ollamaFacts(root, names, fetchImpl, timeoutMs)
      : await lmStudioFacts(root, names, fetchImpl, timeoutMs);
  } catch {
    return names.map((name) => ({ name, can: new Set(), at: 0 }));
  }
}

/** The pick among facts already asked for, falling back to the first name. */
function pickFrom(facts: Facts[], names: string[]): ModelPick | undefined {
  if (names.length === 0) return undefined;
  return (
    bestModel(facts) ?? {
      model: names[0] as string,
      reason: "it is the first model listed.",
    }
  );
}

/**
 * The model to start with among `names`, which the program at `baseUrl`
 * listed. Asking it more can fail; the pick then falls back to the names.
 */
export async function pickLocalModel(
  preset: "ollama" | "lmstudio",
  baseUrl: string,
  names: string[],
  options: LocalOptions = {},
): Promise<ModelPick | undefined> {
  if (names.length === 0) return undefined;
  return pickFrom(await localFacts(preset, baseUrl, names, options), names);
}

/**
 * Adds what the program says (tools, pictures, when it was put here) to the
 * models it listed, and leaves out the ones that only make embeddings. Also
 * gives the pick, from the same answers.
 */
export async function describeLocalModels(
  preset: "ollama" | "lmstudio",
  baseUrl: string,
  models: ModelInfo[],
  options: LocalOptions = {},
): Promise<{ models: ModelInfo[]; pick?: ModelPick }> {
  const names = models.map((m) => m.id);
  const facts = await localFacts(preset, baseUrl, names, options);
  const byName = new Map(facts.map((f) => [f.name, f]));
  const out: ModelInfo[] = [];
  for (const model of models) {
    const f = byName.get(model.id);
    if (f && f.can.size > 0 && !f.can.has("completion")) continue;
    out.push({
      ...model,
      ...(f?.can.has("tools") ? { tools: true } : {}),
      ...(f?.can.has("vision") ? { pictures: true } : {}),
      ...(f && f.at > 0 ? { created: f.at } : {}),
    });
  }
  const pick = pickFrom(facts, names);
  return { models: out, ...(pick ? { pick } : {}) };
}
