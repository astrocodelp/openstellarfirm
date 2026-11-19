import type { Preset } from "../shared/catalog";
import type { ModelList } from "../shared/types";
import { describeLocalModels } from "./model-pick";
import { listModelInfo } from "./models";

/**
 * The models a source can pick from. A service with a list is asked for it,
 * with the key in a header only; one without gets the suggestions written in
 * the catalog, and nothing is sent. A program on this computer is also asked
 * what each model can do.
 */
export async function modelsOf(
  preset: Preset,
  baseUrl: string,
  apiKey: string | undefined,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ModelList> {
  if (!preset.lists)
    return { models: preset.suggested ?? [], from: "suggested" };
  const models = await listModelInfo({
    baseUrl,
    wire: preset.wire,
    auth: preset.header,
    ...(apiKey ? { apiKey } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  if (preset.id === "ollama" || preset.id === "lmstudio") {
    const described = await describeLocalModels(
      preset.id,
      baseUrl,
      models,
      options,
    );
    return { models: described.models, from: "listed" };
  }
  return { models, from: "listed" };
}
