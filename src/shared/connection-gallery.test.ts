import { describe, expect, it } from "vitest";
import { CATALOG, type CatalogEntry } from "./connection-catalog";
import {
  addedCounts,
  countByCategory,
  filterConnections,
  findServices,
  fold,
  resultLine,
  usedCategories,
} from "./connection-gallery";

const entry = (
  id: string,
  name: string,
  category: CatalogEntry["category"],
  description = "Does a thing.",
): CatalogEntry => ({
  id,
  name,
  description,
  category,
  reads: true,
  url: `https://${id}.example.com/mcp`,
  keyStyle: "bearer",
  where: "Settings.",
  link: `https://${id}.example.com/docs`,
});

const SAMPLE = [
  entry("zeta-search", "Zeta", "Search and web", "Search the web."),
  entry("acme-git", "Acme Git", "Code", "Read repositories and issues."),
  entry("mailo", "Mailo", "Mail and messages", "Send email from inboxes."),
  entry("searchly", "Searchly", "Search and web", "Find pages."),
];

describe("finding a service", () => {
  it("shows everything, by name, when nothing is typed", () => {
    expect(findServices("", "all", SAMPLE).map((e) => e.name)).toEqual([
      "Acme Git",
      "Mailo",
      "Searchly",
      "Zeta",
    ]);
  });

  it("matches the name, the description, the id and the group", () => {
    const names = (q: string) =>
      findServices(q, "all", SAMPLE).map((e) => e.name);
    expect(names("mailo")).toEqual(["Mailo"]);
    expect(names("repositories")).toEqual(["Acme Git"]);
    expect(names("acme git")).toEqual(["Acme Git"]);
    expect(names("code")).toEqual(["Acme Git"]);
    expect(names("mail and messages")).toEqual(["Mailo"]);
  });

  it("needs every word, in any order, ignoring case and accents", () => {
    const names = (q: string) =>
      findServices(q, "all", SAMPLE).map((e) => e.name);
    expect(names("  ISSUES   read ")).toEqual(["Acme Git"]);
    expect(names("émail")).toEqual(["Mailo"]);
    expect(names("search nothing-like-this")).toEqual([]);
    expect(fold("  Ünïcode\tTEXT ")).toBe("unicode text");
  });

  it("puts a name that starts with the search first", () => {
    expect(findServices("search", "all", SAMPLE).map((e) => e.name)).toEqual([
      "Searchly",
      "Zeta",
    ]);
  });

  it("keeps to one group when one is chosen", () => {
    expect(
      findServices("", "Search and web", SAMPLE).map((e) => e.name),
    ).toEqual(["Searchly", "Zeta"]);
    expect(findServices("repositories", "Search and web", SAMPLE)).toEqual([]);
  });

  it("counts each group after the search", () => {
    const counts = countByCategory("search", SAMPLE);
    expect(counts.all).toBe(2);
    expect(counts["Search and web"]).toBe(2);
    expect(counts.Code).toBe(0);
    expect(usedCategories(SAMPLE)).toEqual([
      "Code",
      "Search and web",
      "Mail and messages",
    ]);
  });

  it("finds every real entry by its own name", () => {
    for (const e of CATALOG)
      expect(
        findServices(e.name).map((x) => x.id),
        e.id,
      ).toContain(e.id);
    expect(countByCategory("").all).toBe(CATALOG.length);
  });

  it("says what it found", () => {
    expect(resultLine(50, 50)).toBe("50 services");
    expect(resultLine(1, 50)).toBe("1 of 50 services");
    expect(resultLine(7, 50)).toBe("7 of 50 services");
    expect(resultLine(0, 50)).toBe("No service matches");
  });
});

describe("what is added already", () => {
  it("counts saved connections by their catalog entry only", () => {
    const counts = addedCounts([
      { preset: "catalog:github" },
      { preset: "catalog:github" },
      { preset: "catalog:exa" },
      { preset: "catalog:nope" },
      { preset: "composio" },
      { preset: "custom" },
      {},
    ]);
    expect(counts.get("github")).toBe(2);
    expect(counts.get("exa")).toBe(1);
    expect(counts.has("nope")).toBe(false);
    expect(counts.size).toBe(2);
  });
});

describe("the connection picker's search", () => {
  const items = [
    { id: "1", name: "Work", service: "GitHub" },
    { id: "2", name: "Home", service: "GitHub" },
    { id: "3", name: "Research", service: "Exa" },
  ];
  const find = (q: string) =>
    filterConnections(items, q, (i) => i.service).map((i) => i.id);

  it("matches the name or the service, and shows all when empty", () => {
    expect(find("")).toEqual(["1", "2", "3"]);
    expect(find("github")).toEqual(["1", "2"]);
    expect(find("home git")).toEqual(["2"]);
    expect(find("exa")).toEqual(["3"]);
    expect(find("slack")).toEqual([]);
  });
});
