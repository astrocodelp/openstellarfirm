import { readAssistantFile } from "../../shared/assistant-file";
import type { AssistantInput } from "../../shared/types";

/**
 * The starter personas in the `personas/` folder, bundled at build time. One
 * file there is one persona: nothing here needs a change when one is added.
 * A persona is only a starting point for the form. It sets no model, folder,
 * site or web access, and nothing is saved until the person saves.
 */
export interface Persona {
  assistant: AssistantInput;
  summary: string;
}

const files = import.meta.glob("../../../personas/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export const PERSONAS: Persona[] = Object.keys(files)
  .sort()
  .flatMap((path) => {
    try {
      const { assistant, summary } = readAssistantFile(files[path]);
      return [{ assistant, summary: summary ?? "" }];
    } catch {
      // A file that fails the checks is left out. The tests catch it first.
      return [];
    }
  });
