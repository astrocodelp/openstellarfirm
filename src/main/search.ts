import { SEARCH_QUERY_MAX, searchChats } from "../shared/search";
import type { SearchHit } from "../shared/types";
import type { Store } from "./store";

/**
 * Search in chats, run in the main process over the chat files on this
 * computer. The page sends a piece of text and gets plain parts back.
 */

/** The search from the page is used only when it is a plain, short string. */
export function searchQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > SEARCH_QUERY_MAX)
    throw new Error("That is not allowed.");
  return value;
}

export function searchStore(
  store: Pick<Store, "assistants" | "messages">,
  query: string,
): SearchHit[] {
  const chats = store.assistants().map((assistant) => {
    try {
      return {
        assistantId: assistant.id,
        messages: store.messages(assistant.id),
      };
    } catch {
      // A chat file that cannot be read is left out, never the whole search.
      return { assistantId: assistant.id, messages: [] };
    }
  });
  return searchChats(chats, query);
}
