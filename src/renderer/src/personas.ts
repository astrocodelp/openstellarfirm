import { readAssistantFile } from "../../shared/assistant-file";
import { isCategory } from "../../shared/gallery";
import type { CategoryId } from "../../shared/skill-library";
import type { AssistantInput } from "../../shared/types";

/**
 * The starter personas in the `personas/` folder, bundled at build time. One
 * file there is one persona: nothing here needs a change when one is added.
 * A persona is only a starting point for the form. It sets no model, folder,
 * site or web access, and nothing is saved until the person saves.
 */
export interface Persona {
  /** The file's name without `.json`, such as `sales`. */
  id: string;
  assistant: AssistantInput;
  summary: string;
  /** The gallery heading it is filed under. */
  category: CategoryId;
}

const files = import.meta.glob("../../../personas/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

export const PERSONAS: Persona[] = Object.keys(files)
  .sort()
  .flatMap((path) => {
    try {
      const raw = files[path];
      const { assistant, summary } = readAssistantFile(raw);
      const category = (raw as { category?: unknown }).category;
      const id = path.replace(/^.*\//, "").replace(/\.json$/, "");
      return [
        {
          id,
          assistant,
          summary: summary ?? "",
          // A community file with no known category still shows, under Everyday.
          category: isCategory(category) ? category : "everyday",
        },
      ];
    } catch {
      // A file that fails the checks is left out. The tests catch it first.
      return [];
    }
  });
