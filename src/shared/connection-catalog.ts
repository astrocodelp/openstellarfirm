import type { ConnectionPreset } from "./types";

/**
 * Services that run their own remote MCP server and take a key or token the
 * person makes in that service, sent in a request header. The list is fixed in
 * code. The address and the header of an entry are pinned in the main process:
 * a page, a file or a server can never choose them.
 *
 * Every entry was checked against the service's own documentation (the `link`
 * is that page). A service that only signs in through a browser, or that wants
 * the key in the address, is not here: the app never puts a key in an address.
 */

/** How the key travels. A small, typed choice, never text from outside. */
export type KeyStyle = "bearer" | "x-api-key";

export interface CatalogEntry {
  id: string;
  name: string;
  /** What an assistant can do with it, in one plain line. */
  description: string;
  /** The one address. Exactly as the service documents it. */
  url: string;
  keyStyle: KeyStyle;
  /** Where the person makes the key, and which kind to make. */
  where: string;
  /** The service's own page about its server or keys. Opened on a click. */
  link: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Read repositories, issues and pull requests.",
    url: "https://api.githubcopilot.com/mcp/",
    keyStyle: "bearer",
    where:
      "GitHub, Settings, Developer settings, Personal access tokens. Make a fine-grained token with read access only, for the repositories you want to share.",
    link: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Look up and track issues, projects and cycles.",
    url: "https://mcp.linear.app/mcp",
    keyStyle: "bearer",
    where:
      "Linear, Settings, Security and access, Personal API keys. Make a key with the Read permission only.",
    link: "https://linear.app/docs/mcp",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Look up customers, payments, invoices and subscriptions.",
    url: "https://mcp.stripe.com",
    keyStyle: "bearer",
    where:
      "Stripe Dashboard, Developers, API keys. Make an agent API key and give it read permissions only. Use a sandbox first.",
    link: "https://docs.stripe.com/mcp",
  },
  {
    id: "neon",
    name: "Neon",
    description: "Look at your Postgres projects, branches and tables.",
    url: "https://mcp.neon.tech/mcp",
    keyStyle: "bearer",
    where:
      "Neon console, Account settings, API keys. Make a key for one project if you can.",
    link: "https://neon.com/docs/ai/neon-mcp-server",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Look at your Supabase projects, tables and logs.",
    url: "https://mcp.supabase.com/mcp",
    keyStyle: "bearer",
    where:
      "Supabase dashboard, Account, Access tokens. Make a personal access token for this use only.",
    link: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "apify",
    name: "Apify",
    description: "Run ready-made scrapers and web tools.",
    url: "https://mcp.apify.com",
    keyStyle: "bearer",
    where:
      "Apify Console, Settings, API and integrations. Make a token for this use only. Running a tool uses your Apify credit.",
    link: "https://docs.apify.com/platform/integrations/mcp",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Read and search web pages as clean text.",
    url: "https://mcp.firecrawl.dev/v2/mcp",
    keyStyle: "bearer",
    where:
      "Firecrawl dashboard, API keys. Copy your key. Using it counts against your Firecrawl plan.",
    link: "https://docs.firecrawl.dev/mcp-server",
  },
  {
    id: "exa",
    name: "Exa",
    description: "Search the web and find pages like a given one.",
    url: "https://mcp.exa.ai/mcp",
    keyStyle: "x-api-key",
    where:
      "Exa dashboard, API keys. Copy your key. Using it counts against your Exa plan.",
    link: "https://docs.exa.ai/reference/exa-mcp",
  },
  {
    id: "context7",
    name: "Context7",
    description: "Look up current documentation for code libraries.",
    url: "https://mcp.context7.com/mcp",
    keyStyle: "bearer",
    where: "Context7 dashboard, API keys. Copy your key.",
    link: "https://github.com/upstash/context7",
  },
  {
    id: "agentmail",
    name: "AgentMail",
    description: "Read and write email in inboxes you made at AgentMail.",
    url: "https://mcp.agentmail.to/mcp",
    keyStyle: "x-api-key",
    where:
      "AgentMail console, API keys. Make a key for this use only. It can send mail from your inboxes, so every call asks first.",
    link: "https://docs.agentmail.to/integrations/mcp",
  },
];

const PREFIX = "catalog:";

export function catalogEntry(id: unknown): CatalogEntry | undefined {
  return typeof id === "string" ? CATALOG.find((e) => e.id === id) : undefined;
}

/** The catalog id inside a preset, when the preset names a real entry. */
export function catalogIdOf(preset: unknown): string | undefined {
  if (typeof preset !== "string" || !preset.startsWith(PREFIX))
    return undefined;
  const id = preset.slice(PREFIX.length);
  return catalogEntry(id) ? id : undefined;
}

export function catalogPreset(id: string): ConnectionPreset {
  return `${PREFIX}${id}`;
}

/**
 * Only the exact word "composio" or a real catalog entry makes a preset;
 * anything else, a hand-edited file included, is custom.
 */
export function connectionPresetOf(connection: {
  preset?: unknown;
}): ConnectionPreset {
  if (connection.preset === "composio") return "composio";
  const id = catalogIdOf(connection.preset);
  return id ? catalogPreset(id) : "custom";
}

/** What a connection is to, in words a person reads: the service, or the address's host. */
export function serviceLabel(connection: {
  preset?: unknown;
  baseUrl: string;
}): string {
  if (connection.preset === "composio") return "Composio";
  const entry = catalogEntry(catalogIdOf(connection.preset));
  if (entry) return entry.name;
  try {
    return new URL(connection.baseUrl).host;
  } catch {
    return connection.baseUrl;
  }
}
