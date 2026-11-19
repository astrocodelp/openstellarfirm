import {
  CATALOG,
  CATEGORIES,
  type CatalogEntry,
  type Category,
  catalogIdOf,
} from "./connection-catalog";

/**
 * Finding a service in the catalog: a typed search and one category at a
 * time. Pure, so the gallery and the tests share it.
 */

/** Lower case, accents taken off, runs of space made one. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The words an entry can be found by: its name, id, description and group. */
function haystack(entry: CatalogEntry): string {
  return fold(
    `${entry.name} ${entry.id.replace(/-/g, " ")} ${entry.description} ${entry.category}`,
  );
}

/**
 * Entries whose words hold every word typed, in the chosen category ("all"
 * for any). Name matches come first, then the rest, each by name.
 */
export function findServices(
  query: string,
  category: Category | "all" = "all",
  entries: readonly CatalogEntry[] = CATALOG,
): CatalogEntry[] {
  const words = fold(query).split(" ").filter(Boolean);
  const inGroup =
    category === "all"
      ? entries
      : entries.filter((e) => e.category === category);
  const hits = inGroup.filter((entry) => {
    const text = haystack(entry);
    return words.every((word) => text.includes(word));
  });
  const nameHit = (e: CatalogEntry) =>
    words.length > 0 && fold(e.name).startsWith(words[0] ?? "") ? 0 : 1;
  return hits.sort(
    (a, b) => nameHit(a) - nameHit(b) || a.name.localeCompare(b.name, "en"),
  );
}

/** The categories that have at least one entry, in the fixed order. */
export function usedCategories(
  entries: readonly CatalogEntry[] = CATALOG,
): Category[] {
  return CATEGORIES.filter((c) => entries.some((e) => e.category === c));
}

/** How many entries each category has once the search is applied. */
export function countByCategory(
  query: string,
  entries: readonly CatalogEntry[] = CATALOG,
): Record<Category | "all", number> {
  const counts = { all: 0 } as Record<Category | "all", number>;
  for (const c of CATEGORIES) counts[c] = 0;
  for (const entry of findServices(query, "all", entries)) {
    counts.all += 1;
    counts[entry.category] += 1;
  }
  return counts;
}

/** How many saved connections use each catalog entry. */
export function addedCounts(
  connections: readonly { preset?: unknown }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    const id = catalogIdOf(connection.preset);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** "1 service", "12 services": what the search found, said out loud too. */
export function resultLine(n: number, total: number): string {
  if (n === total) return `${total} services`;
  if (n === 0) return "No service matches";
  return n === 1 ? `1 of ${total} services` : `${n} of ${total} services`;
}

/** Connections whose name or service holds every word typed. */
export function filterConnections<T extends { name: string }>(
  items: readonly T[],
  query: string,
  label: (item: T) => string,
): T[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const text = fold(`${item.name} ${label(item)}`);
    return words.every((word) => text.includes(word));
  });
}

/**
 * The last card in the row of the card at `index`, in a grid of `columns`.
 * An open card's form goes straight after it, so the card stays where it was
 * and no row is left with a hole.
 */
export function rowEnd(index: number, count: number, columns: number): number {
  const across = Math.max(1, Math.floor(columns));
  const last = Math.floor(index / across) * across + across - 1;
  return Math.min(Math.max(count - 1, 0), last);
}
