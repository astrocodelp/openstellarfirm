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

/**
 * How the key travels. A small, typed choice, never text from outside. Each
 * style is one header with a fixed name and a fixed text before the key.
 */
export type KeyStyle = "bearer" | "x-api-key" | "x-ref-api-key" | "token";

export const KEY_HEADERS: Readonly<
  Record<KeyStyle, { name: string; prefix: string }>
> = {
  bearer: { name: "Authorization", prefix: "Bearer " },
  "x-api-key": { name: "x-api-key", prefix: "" },
  // Ref's own header for its key.
  "x-ref-api-key": { name: "x-ref-api-key", prefix: "" },
  // PagerDuty's REST key form: "Authorization: Token token=<key>".
  token: { name: "Authorization", prefix: "Token token=" },
};

/** The groups the gallery sorts services into. */
export const CATEGORIES = [
  "Code",
  "Data and databases",
  "Search and web",
  "Payments and money",
  "Work and projects",
  "Mail and messages",
  "Files and docs",
  "Design and media",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CatalogEntry {
  id: string;
  name: string;
  /** What an assistant can do with it, in one plain line. */
  description: string;
  category: Category;
  /** True when most of its tools only read. Every call still asks first. */
  reads: boolean;
  /** The one address. Exactly as the service documents it. */
  url: string;
  keyStyle: KeyStyle;
  /** Where the person makes the key, and which kind to make. */
  where: string;
  /** The service's own page about its server or keys. Opened on a click. */
  link: string;
}

/*
 * Each entry names the page its address and header were read from, and the day
 * they were read. Before adding one, read the service's own page: a remote
 * server at one fixed https address, a key the person makes, sent in a header.
 */
export const CATALOG: readonly CatalogEntry[] = [
  // Code

  // Read 2026-11-19: https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/set-up-the-github-mcp-server
  {
    id: "github",
    name: "GitHub",
    description: "Read repositories, issues and pull requests.",
    category: "Code",
    reads: false,
    url: "https://api.githubcopilot.com/mcp/",
    keyStyle: "bearer",
    where:
      "GitHub, Settings, Developer settings, Personal access tokens. Make a fine-grained token with read access only, for the repositories you want to share.",
    link: "https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md",
  },
  // Read 2026-11-19: https://context7.com/docs/resources/all-clients
  {
    id: "context7",
    name: "Context7",
    description: "Look up current documentation for code libraries.",
    category: "Code",
    reads: true,
    url: "https://mcp.context7.com/mcp",
    keyStyle: "bearer",
    where: "Context7 dashboard, API keys. Copy your key.",
    link: "https://context7.com/docs/resources/all-clients",
  },
  // Read 2026-11-19: https://docs.ref.tools/context/install.md
  {
    id: "ref",
    name: "Ref",
    description: "Search and read current technical documentation.",
    category: "Code",
    reads: true,
    url: "https://api.ref.tools/mcp",
    keyStyle: "x-ref-api-key",
    where:
      "Ref, signed in, at ref.tools/keys. Copy your key. Searches count against your Ref plan.",
    link: "https://docs.ref.tools/context/install",
  },
  // Read 2026-11-19: https://github.com/huggingface/hf-mcp-server
  {
    id: "hugging-face",
    name: "Hugging Face",
    description: "Search models, datasets, Spaces and papers on the Hub.",
    category: "Code",
    reads: true,
    url: "https://huggingface.co/mcp",
    keyStyle: "bearer",
    where:
      "Hugging Face, Settings, Access Tokens. A read token is enough for searching.",
    link: "https://github.com/huggingface/hf-mcp-server",
  },
  // Read 2026-11-19: https://render.com/docs/mcp-server
  {
    id: "render",
    name: "Render",
    description: "Look at services, deploys, logs and databases on Render.",
    category: "Code",
    reads: false,
    url: "https://mcp.render.com/mcp",
    keyStyle: "bearer",
    where:
      "Render Dashboard, Account Settings, API Keys. The key reaches every workspace you belong to.",
    link: "https://render.com/docs/mcp-server",
  },
  // Read 2026-11-19: https://buildkite.com/docs/apis/mcp-server
  {
    id: "buildkite",
    name: "Buildkite",
    description: "Check pipelines, builds, jobs and their logs.",
    category: "Code",
    reads: false,
    url: "https://mcp.buildkite.com/direct",
    keyStyle: "bearer",
    where:
      "Buildkite, Personal Settings, API Access Tokens. Give the token read scopes only, unless you want it to change things.",
    link: "https://buildkite.com/docs/apis/mcp-server",
  },
  // Read 2026-11-19: https://learning.postman.com/docs/reference/postman-api/postman-mcp-server/postman-mcp-remote-server/
  {
    id: "postman",
    name: "Postman",
    description: "Work with collections, APIs and workspaces.",
    category: "Code",
    reads: false,
    url: "https://mcp.postman.com/mcp",
    keyStyle: "bearer",
    where: "Postman, Settings, API keys, Generate API key.",
    link: "https://learning.postman.com/docs/reference/postman-api/postman-mcp-server/postman-mcp-remote-server/",
  },
  // Read 2026-11-19: https://docs.digitalocean.com/reference/mcp/configure-mcp/
  {
    id: "digitalocean",
    name: "DigitalOcean",
    description: "Look at Droplets, apps, Kubernetes and databases.",
    category: "Code",
    reads: false,
    url: "https://mcp.digitalocean.com/mcp",
    keyStyle: "bearer",
    where:
      "DigitalOcean control panel, API, Tokens, Generate New Token. A read-only token keeps it to looking.",
    link: "https://docs.digitalocean.com/reference/mcp/configure-mcp/",
  },
  // Read 2026-11-19: https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Look at zones, Workers, DNS and settings.",
    category: "Code",
    reads: false,
    url: "https://mcp.cloudflare.com/mcp",
    keyStyle: "bearer",
    where:
      "Cloudflare dashboard, My Profile, API Tokens. Give the token only the permissions you want an assistant to have.",
    link: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  // Read 2026-11-19: https://www.pulumi.com/docs/iac/guides/ai-integration/mcp-server/
  {
    id: "pulumi",
    name: "Pulumi",
    description: "Look up stacks, resources and the Pulumi registry.",
    category: "Code",
    reads: true,
    url: "https://mcp.ai.pulumi.com/mcp",
    keyStyle: "bearer",
    where:
      "Pulumi Cloud, Settings, Access Tokens. A personal token uses the first organization it can reach.",
    link: "https://www.pulumi.com/docs/iac/guides/ai-integration/mcp-server/",
  },

  // Data and databases

  // Read 2026-11-19: https://neon.com/docs/ai/neon-mcp-server
  {
    id: "neon",
    name: "Neon",
    description: "Look at your Postgres projects, branches and tables.",
    category: "Data and databases",
    reads: false,
    url: "https://mcp.neon.tech/mcp",
    keyStyle: "bearer",
    where:
      "Neon console, Account settings, API keys. Make a key for one project if you can.",
    link: "https://neon.com/docs/ai/neon-mcp-server",
  },
  // Read 2026-11-19: https://supabase.com/docs/guides/getting-started/mcp
  {
    id: "supabase",
    name: "Supabase",
    description: "Look at your Supabase projects, tables and logs.",
    category: "Data and databases",
    reads: false,
    url: "https://mcp.supabase.com/mcp",
    keyStyle: "bearer",
    where:
      "Supabase dashboard, Account, Access tokens. Make a personal access token for this use only.",
    link: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  // Read 2026-11-19: https://motherduck.com/docs/sql-reference/mcp/
  {
    id: "motherduck",
    name: "MotherDuck",
    description: "Ask your MotherDuck and DuckDB databases in SQL.",
    category: "Data and databases",
    reads: false,
    url: "https://api.motherduck.com/mcp",
    keyStyle: "bearer",
    where:
      "MotherDuck, Settings, Access tokens. A read scaling token keeps it to reading.",
    link: "https://motherduck.com/docs/sql-reference/mcp/",
  },
  // Read 2026-11-19: https://www.tinybird.co/docs/forward/analytics-agents/mcp
  {
    id: "tinybird",
    name: "Tinybird",
    description: "Ask your Tinybird data sources and endpoints.",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.tinybird.co",
    keyStyle: "bearer",
    where:
      "Tinybird, Tokens. Make a token with only the scopes you want to share.",
    link: "https://www.tinybird.co/docs/forward/analytics-agents/mcp",
  },
  // Read 2026-11-19: https://posthog.com/docs/model-context-protocol/faq
  {
    id: "posthog",
    name: "PostHog",
    description: "Look at analytics, feature flags, experiments and errors.",
    category: "Data and databases",
    reads: false,
    url: "https://mcp.posthog.com/mcp",
    keyStyle: "bearer",
    where:
      "PostHog, Settings, User API keys. Use the MCP Server preset, scoped to one project.",
    link: "https://posthog.com/docs/model-context-protocol/faq",
  },
  // Read 2026-11-19: https://docs.datadoghq.com/mcp_server/setup.md
  {
    id: "datadog",
    name: "Datadog",
    description: "Search logs, metrics, traces, monitors and incidents (US1).",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.datadoghq.com/v1/mcp",
    keyStyle: "bearer",
    where:
      "Datadog, Organization settings, Personal access tokens. This address is for the US1 site.",
    link: "https://docs.datadoghq.com/mcp_server/setup/",
  },
  // Read 2026-11-19: https://docs.datadoghq.com/mcp_server/setup.md
  {
    id: "datadog-eu",
    name: "Datadog (EU)",
    description: "Search logs, metrics, traces, monitors and incidents (EU1).",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.datadoghq.eu/v1/mcp",
    keyStyle: "bearer",
    where:
      "Datadog, Organization settings, Personal access tokens. This address is for the EU1 site.",
    link: "https://docs.datadoghq.com/mcp_server/setup/",
  },
  // Read 2026-11-19: https://docs.honeycomb.io/integrations/mcp/configuration-guide/
  {
    id: "honeycomb",
    name: "Honeycomb",
    description: "Look at traces, datasets, SLOs and boards (US).",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.honeycomb.io/mcp",
    keyStyle: "bearer",
    where:
      "Honeycomb, Team settings, API keys. A team owner makes a management key with the Model Context Protocol and Environments scopes, read only. Paste it as key ID, a colon, then the secret.",
    link: "https://docs.honeycomb.io/integrations/mcp/configuration-guide/",
  },
  // Read 2026-11-19: https://docs.honeycomb.io/integrations/mcp/configuration-guide/
  {
    id: "honeycomb-eu",
    name: "Honeycomb (EU)",
    description: "Look at traces, datasets, SLOs and boards (EU).",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.eu1.honeycomb.io/mcp",
    keyStyle: "bearer",
    where:
      "Honeycomb EU, Team settings, API keys. A team owner makes a management key with the Model Context Protocol and Environments scopes, read only. Paste it as key ID, a colon, then the secret.",
    link: "https://docs.honeycomb.io/integrations/mcp/configuration-guide/",
  },
  // Read 2026-11-19: https://pydantic.dev/docs/logfire/guides/mcp-server/
  {
    id: "logfire",
    name: "Pydantic Logfire",
    description: "Ask your Logfire traces, logs and metrics in SQL (US).",
    category: "Data and databases",
    reads: true,
    url: "https://logfire-us.pydantic.dev/mcp",
    keyStyle: "bearer",
    where:
      "Logfire, project settings, API keys. The key needs the project:read scope.",
    link: "https://pydantic.dev/docs/logfire/guides/mcp-server/",
  },
  // Read 2026-11-19: https://pydantic.dev/docs/logfire/guides/mcp-server/
  {
    id: "logfire-eu",
    name: "Pydantic Logfire (EU)",
    description: "Ask your Logfire traces, logs and metrics in SQL (EU).",
    category: "Data and databases",
    reads: true,
    url: "https://logfire-eu.pydantic.dev/mcp",
    keyStyle: "bearer",
    where:
      "Logfire EU, project settings, API keys. The key needs the project:read scope.",
    link: "https://pydantic.dev/docs/logfire/guides/mcp-server/",
  },
  // Read 2026-11-19: https://betterstack.com/docs/getting-started/integrations/mcp/
  {
    id: "better-stack",
    name: "Better Stack",
    description: "Check monitors, incidents, logs and who is on call.",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.betterstack.com",
    keyStyle: "bearer",
    where: "Better Stack, API tokens. A read-only token is enough to look.",
    link: "https://betterstack.com/docs/getting-started/integrations/mcp/",
  },
  // Read 2026-11-19: https://docs.coreweave.com/platform/mcp-server
  {
    id: "wandb",
    name: "Weights & Biases",
    description: "Look up runs, metrics, reports and Weave traces.",
    category: "Data and databases",
    reads: true,
    url: "https://mcp.withwandb.com/mcp",
    keyStyle: "bearer",
    where: "wandb.ai, User Settings, API keys. This is the public cloud only.",
    link: "https://docs.coreweave.com/platform/mcp-server",
  },

  // Search and web

  // Read 2026-11-19: https://docs.apify.com/platform/integrations/mcp
  {
    id: "apify",
    name: "Apify",
    description: "Run ready-made scrapers and web tools.",
    category: "Search and web",
    reads: false,
    url: "https://mcp.apify.com",
    keyStyle: "bearer",
    where:
      "Apify Console, Settings, API and integrations. Make a token for this use only. Running a tool uses your Apify credit.",
    link: "https://docs.apify.com/platform/integrations/mcp",
  },
  // Read 2026-11-19: https://docs.firecrawl.dev/mcp-server
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Read and search web pages as clean text.",
    category: "Search and web",
    reads: true,
    url: "https://mcp.firecrawl.dev/v2/mcp",
    keyStyle: "bearer",
    where:
      "Firecrawl dashboard, API keys. Copy your key. Using it counts against your Firecrawl plan.",
    link: "https://docs.firecrawl.dev/mcp-server",
  },
  // Read 2026-11-19: https://docs.exa.ai/reference/exa-mcp
  {
    id: "exa",
    name: "Exa",
    description: "Search the web and find pages like a given one.",
    category: "Search and web",
    reads: true,
    url: "https://mcp.exa.ai/mcp",
    keyStyle: "x-api-key",
    where:
      "Exa dashboard, API keys. Copy your key. Using it counts against your Exa plan.",
    link: "https://docs.exa.ai/reference/exa-mcp",
  },
  // Read 2026-11-19: https://github.com/jina-ai/MCP
  {
    id: "jina",
    name: "Jina AI",
    description: "Read web pages, search the web and rank results.",
    category: "Search and web",
    reads: true,
    url: "https://mcp.jina.ai/v1",
    keyStyle: "bearer",
    where:
      "jina.ai, API key page. Copy your key. Using it counts against your Jina token balance.",
    link: "https://github.com/jina-ai/MCP",
  },
  // Read 2026-11-19: https://docs.parallel.ai/integrations/mcp/search-mcp
  {
    id: "parallel",
    name: "Parallel",
    description: "Search the web and pull text out of pages.",
    category: "Search and web",
    reads: true,
    url: "https://search.parallel.ai/mcp",
    keyStyle: "bearer",
    where:
      "Parallel platform, API keys. Using it counts against your Parallel plan.",
    link: "https://docs.parallel.ai/integrations/mcp/search-mcp",
  },
  // Read 2026-11-19: https://docs.linkup.so/pages/integrations/mcp/mcp
  {
    id: "linkup",
    name: "Linkup",
    description: "Search the web for answers with their sources.",
    category: "Search and web",
    reads: true,
    url: "https://mcp.linkup.so/mcp",
    keyStyle: "bearer",
    where:
      "Linkup dashboard, API keys. Using it counts against your Linkup plan.",
    link: "https://docs.linkup.so/pages/integrations/mcp/mcp",
  },
  // Read 2026-11-19: https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Search the web and get answers with their sources.",
    category: "Search and web",
    reads: true,
    url: "https://api.perplexity.ai/mcp",
    keyStyle: "bearer",
    where:
      "Perplexity, API settings, API Keys. Using it counts against your Perplexity API credit.",
    link: "https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server",
  },
  // Read 2026-11-19: https://serpapi.com/mcp
  {
    id: "serpapi",
    name: "SerpApi",
    description: "Search Google and other search engines.",
    category: "Search and web",
    reads: true,
    url: "https://mcp.serpapi.com/mcp",
    keyStyle: "bearer",
    where:
      "SerpApi dashboard. Copy your API key. Each search counts against your SerpApi plan.",
    link: "https://serpapi.com/mcp",
  },
  // Read 2026-11-19: https://you.com/docs/developer-resources/mcp-server
  {
    id: "you-com",
    name: "You.com",
    description: "Search the web and read page content.",
    category: "Search and web",
    reads: true,
    url: "https://api.you.com/mcp",
    keyStyle: "bearer",
    where:
      "you.com/platform, API keys. Using it counts against your You.com API credit.",
    link: "https://you.com/docs/developer-resources/mcp-server",
  },

  // Payments and money

  // Read 2026-11-19: https://docs.stripe.com/mcp
  {
    id: "stripe",
    name: "Stripe",
    description: "Look up customers, payments, invoices and subscriptions.",
    category: "Payments and money",
    reads: false,
    url: "https://mcp.stripe.com",
    keyStyle: "bearer",
    where:
      "Stripe Dashboard, Developers, API keys. Make an agent API key and give it read permissions only. Use a sandbox first.",
    link: "https://docs.stripe.com/mcp",
  },

  // Work and projects

  // Read 2026-11-19: https://linear.app/docs/mcp
  {
    id: "linear",
    name: "Linear",
    description: "Look up and track issues, projects and cycles.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.linear.app/mcp",
    keyStyle: "bearer",
    where:
      "Linear, Settings, Security and access, Personal API keys. Make a key with the Read permission only.",
    link: "https://linear.app/docs/mcp",
  },
  // Read 2026-11-19: https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/
  {
    id: "atlassian",
    name: "Jira and Confluence",
    description: "Read and update Jira issues and Confluence pages.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.atlassian.com/v2/mcp",
    keyStyle: "bearer",
    where:
      "An Atlassian organization admin makes a service account API key at admin.atlassian.com, Directory, Service accounts, and allows API token sign-in for the server.",
    link: "https://support.atlassian.com/atlassian-rovo-mcp-server/docs/configuring-authentication-via-api-token/",
  },
  // Read 2026-11-19: https://github.com/mondaycom/mcp
  {
    id: "monday",
    name: "monday.com",
    description: "Read and update boards, items and updates.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.monday.com/mcp",
    keyStyle: "bearer",
    where:
      "monday.com, your profile, Developers, My access tokens. Copy your personal API token. It acts as you.",
    link: "https://github.com/mondaycom/mcp",
  },
  // Read 2026-11-19: https://developers.smartsheet.com/ai-mcp/smartsheet/install-the-smartsheet-mcp-server/connect-cursor
  {
    id: "smartsheet",
    name: "Smartsheet",
    description: "Read and change sheets, rows and reports.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.smartsheet.com",
    keyStyle: "bearer",
    where:
      "Smartsheet, Personal Settings, API Access. Make a personal API access token. Your plan needs API access. This is the US address.",
    link: "https://developers.smartsheet.com/ai-mcp/smartsheet/install-the-smartsheet-mcp-server/connect-cursor",
  },
  // Read 2026-11-19: https://developers.wrike.com/docs/mcp-legacy-authentication-pat
  {
    id: "wrike",
    name: "Wrike",
    description: "Read and update tasks, folders and projects.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.wrike.com/v2",
    keyStyle: "bearer",
    where:
      "Wrike, your profile, Apps & Integrations, API. Make an app, then a permanent access token.",
    link: "https://developers.wrike.com/docs/mcp-legacy-authentication-pat",
  },
  // Read 2026-11-19: https://clockify.me/help/integrations-and-add-ons/use-clockify-mcp-server-to-connect-to-ai-agent
  {
    id: "clockify",
    name: "Clockify",
    description: "Track time and read timesheets, projects and reports.",
    category: "Work and projects",
    reads: false,
    url: "https://api.clockify.me/mcp-server/mcp",
    keyStyle: "x-api-key",
    where: "Clockify, Preferences, Advanced, Manage API keys, Generate New.",
    link: "https://clockify.me/help/integrations-and-add-ons/use-clockify-mcp-server-to-connect-to-ai-agent",
  },
  // Read 2026-11-19: https://docs.fireflies.ai/getting-started/mcp-configuration
  {
    id: "fireflies",
    name: "Fireflies",
    description: "Search meeting notes, summaries and action items.",
    category: "Work and projects",
    reads: true,
    url: "https://api.fireflies.ai/mcp",
    keyStyle: "bearer",
    where:
      "Fireflies, Settings, Developer Settings. Copy your API key. It acts as you.",
    link: "https://docs.fireflies.ai/getting-started/mcp-configuration",
  },
  // Read 2026-11-19: https://docs.pagerduty.com/developer/mcp-tooling-remote-server
  {
    id: "pagerduty",
    name: "PagerDuty",
    description: "Look up incidents, services and on-call schedules.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.pagerduty.com/mcp",
    keyStyle: "token",
    where:
      "PagerDuty, Integrations, API Access Keys. Make a read-only REST API key unless you want it to change incidents.",
    link: "https://docs.pagerduty.com/developer/mcp-tooling-remote-server",
  },
  // Read 2026-11-19: https://docs.zapier.com/mcp/get-started/connect/other
  {
    id: "zapier",
    name: "Zapier",
    description: "Run the Zapier actions you turned on, across many apps.",
    category: "Work and projects",
    reads: false,
    url: "https://mcp.zapier.com/api/v1/connect",
    keyStyle: "bearer",
    where:
      "mcp.zapier.com, Add MCP server, Other, Settings, API token, Generate token. Pick the actions it may run there.",
    link: "https://docs.zapier.com/mcp/get-started/connect/other",
  },

  // Mail and messages

  // Read 2026-11-19: https://docs.agentmail.to/integrations/mcp
  {
    id: "agentmail",
    name: "AgentMail",
    description: "Read and write email in inboxes you made at AgentMail.",
    category: "Mail and messages",
    reads: false,
    url: "https://mcp.agentmail.to/mcp",
    keyStyle: "x-api-key",
    where:
      "AgentMail console, API keys. Make a key for this use only. It can send mail from your inboxes, so every call asks first.",
    link: "https://docs.agentmail.to/integrations/mcp",
  },
  // Read 2026-11-19: https://developers.intercom.com/docs/guides/mcp
  {
    id: "intercom",
    name: "Intercom",
    description: "Search conversations, contacts and help articles (US).",
    category: "Mail and messages",
    reads: false,
    url: "https://mcp.intercom.com/mcp",
    keyStyle: "bearer",
    where:
      "Intercom, Developer Hub, your app, Authentication. Copy its access token, with the scopes Intercom lists for the server.",
    link: "https://developers.intercom.com/docs/guides/mcp",
  },
  // Read 2026-11-19: https://developers.intercom.com/docs/guides/mcp
  {
    id: "intercom-eu",
    name: "Intercom (EU)",
    description: "Search conversations, contacts and help articles (EU).",
    category: "Mail and messages",
    reads: false,
    url: "https://mcp.eu.intercom.com/mcp",
    keyStyle: "bearer",
    where:
      "Intercom, Developer Hub, your app, Authentication. Copy its access token, with the scopes Intercom lists for the server.",
    link: "https://developers.intercom.com/docs/guides/mcp",
  },
  // Read 2026-11-19: https://resend.com/docs/mcp-server
  {
    id: "resend",
    name: "Resend",
    description: "Send email and manage domains, contacts and broadcasts.",
    category: "Mail and messages",
    reads: false,
    url: "https://mcp.resend.com/mcp",
    keyStyle: "bearer",
    where: "Resend dashboard, API Keys. A sending-only key is the narrowest.",
    link: "https://resend.com/docs/mcp-server",
  },
  // Read 2026-11-19: https://developers.brevo.com/docs/mcp-protocol
  {
    id: "brevo",
    name: "Brevo",
    description: "Manage contacts, lists, campaigns and email.",
    category: "Mail and messages",
    reads: false,
    url: "https://mcp.brevo.com/v1/brevo/mcp",
    keyStyle: "bearer",
    where:
      "Brevo, Account, SMTP & API, API Keys. Make a key and tick the MCP option.",
    link: "https://developers.brevo.com/docs/mcp-protocol",
  },
  // Read 2026-11-19: https://mailchimp.com/developer/transactional/guides/how-to-use-mailchimps-transactional-messaging-mcp/
  {
    id: "mailchimp-transactional",
    name: "Mailchimp Transactional",
    description: "Send transactional email and read sending stats.",
    category: "Mail and messages",
    reads: false,
    url: "https://mandrillapp.com/mcp",
    keyStyle: "bearer",
    where:
      "Mailchimp Transactional (Mandrill), Settings, API Keys, Create New Key. A restricted key needs the AI Agents permission group.",
    link: "https://mailchimp.com/developer/transactional/guides/how-to-use-mailchimps-transactional-messaging-mcp/",
  },

  // Files and docs

  // Read 2026-11-19: https://www.sanity.io/docs/ai/mcp-server
  {
    id: "sanity",
    name: "Sanity",
    description: "Read and edit content in your Sanity datasets.",
    category: "Files and docs",
    reads: false,
    url: "https://mcp.sanity.io",
    keyStyle: "bearer",
    where:
      "sanity.io/manage, your project, API, Tokens. A Viewer token keeps it to reading.",
    link: "https://www.sanity.io/docs/ai/mcp-server",
  },
  // Read 2026-11-19: https://developers.tally.so/api-reference/mcp
  {
    id: "tally",
    name: "Tally",
    description: "Make forms and read the answers people sent.",
    category: "Files and docs",
    reads: false,
    url: "https://api.tally.so/mcp",
    keyStyle: "bearer",
    where: "Tally, Settings, API keys. Make a key for this use only.",
    link: "https://developers.tally.so/api-reference/mcp",
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
