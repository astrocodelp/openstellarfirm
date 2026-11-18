import { checkEndpoint } from "../shared/endpoint";
import type {
  Assistant,
  ComposioInput,
  Connection,
  ConnectionInput,
  ConnectionPreset,
  ConnectionTool,
} from "../shared/types";
import { FolderError } from "./folders";
import { COMPOSIO_MCP_URL, McpClient, McpError, plain } from "./mcp";
import type { ToolSpec } from "./models";
import type { Secrets } from "./secrets";
import type { Store, StoredConnection, StoredTool } from "./store";
import type { PlannedCall } from "./tools";

/**
 * Connections to remote servers: the gate that decides which of their tool
 * calls ask the person, and the service that checks and saves a connection.
 *
 * The rule, in one place. Every call asks, with the connection, the tool and
 * the arguments on the card. Only a tool marked as a read can be allowed for
 * good, and even then it asks again once the answer has read from the
 * person's folders, because arguments can carry text out. Every other tool
 * asks every time, with no way to remember it.
 */

const MAX_ARGUMENT_CHARS = 100_000;
const MAX_NAME = 64;
const MAX_SHOWN_ARGUMENTS = 20;

function field(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("That is not allowed.");
  return value;
}

/**
 * What the page may send for a connection: these four text fields and nothing
 * else. Anything extra (tools, a read mark, a key's place) is left out here.
 */
export function connectionInput(input: unknown): ConnectionInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    ...(typeof raw.id === "string" ? { id: field(raw.id, 100) } : {}),
    name: field(raw.name ?? "", 200),
    baseUrl: field(raw.baseUrl ?? "", 2000),
    ...(typeof raw.apiKey === "string"
      ? { apiKey: field(raw.apiKey, 4096) }
      : {}),
  };
}

/** What the page may send for a Composio connection: a name and a key. */
export function composioInput(input: unknown): ComposioInput {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    ...(typeof raw.id === "string" ? { id: field(raw.id, 100) } : {}),
    name: field(raw.name ?? "", 200),
    ...(typeof raw.apiKey === "string"
      ? { apiKey: field(raw.apiKey, 4096) }
      : {}),
  };
}

/** Only the exact word "composio" makes a preset; anything else is custom. */
export function presetOf(connection: { preset?: unknown }): ConnectionPreset {
  return connection.preset === "composio" ? "composio" : "custom";
}

/** Runs one call on a connection. The main process supplies the real one. */
export type CallTool = (
  connection: StoredConnection,
  tool: string,
  args: Record<string, unknown>,
) => Promise<string>;

/** What the agent needs from an assistant's connections in one answer. */
export interface McpGate {
  specs: ToolSpec[];
  owns(name: string): boolean;
  /** Throws a plain sentence when the call cannot be made at all. */
  plan(name: string, rawArguments: string, afterFiles: boolean): PlannedCall;
  /** Remembers a read for good, when it is one. */
  remember(connectionId: string, tool: string): void;
}

export type GateAssistant = Pick<Assistant, "connections" | "connectionTools">;

interface Entry {
  connection: StoredConnection;
  tool: StoredTool;
}

function parseArguments(raw: string): Record<string, unknown> {
  if (raw.length > MAX_ARGUMENT_CHARS)
    throw new FolderError("The tool call was too large.");
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Falls through to the same sentence.
  }
  throw new FolderError("The tool call was not written correctly. Try again.");
}

/** The arguments as readable lines, each value cut so a card stays short. */
export function argumentLines(args: Record<string, unknown>): string[] {
  const entries = Object.entries(args);
  if (entries.length === 0) return ["(no arguments)"];
  const lines = entries.slice(0, MAX_SHOWN_ARGUMENTS).map(([key, value]) => {
    const shown =
      typeof value === "string" ? value : (JSON.stringify(value) ?? "");
    return `${plain(key, 60)}: ${plain(shown, 300)}`;
  });
  if (entries.length > MAX_SHOWN_ARGUMENTS)
    lines.push(`…and ${entries.length - MAX_SHOWN_ARGUMENTS} more`);
  return lines;
}

/**
 * Builds the tools an assistant is offered from its connections, named
 * `c<N>_<tool>` where N is the connection's place in the assistant's own list.
 * The model never names a connection: the mapping is kept here.
 */
export function buildGate(
  assistant: GateAssistant,
  saved: StoredConnection[],
  call: CallTool,
  persist: (connectionId: string, tool: string) => void,
): McpGate | undefined {
  const byName = new Map<string, Entry>();
  const specs: ToolSpec[] = [];
  assistant.connections.forEach((id, index) => {
    const connection = saved.find((c) => c.id === id);
    if (!connection) return;
    for (const tool of connection.tools) {
      const name = `c${index + 1}_${tool.name}`;
      if (name.length > MAX_NAME || byName.has(name)) continue;
      byName.set(name, { connection, tool });
      specs.push({
        name,
        description: `[${connection.name}] ${tool.description}`.trim(),
        parameters: tool.inputSchema,
      });
    }
  });
  if (specs.length === 0) return undefined;

  /** Live, so a read allowed mid-answer counts at once. */
  const allowed = new Set(assistant.connectionTools);

  return {
    specs,
    owns: (name) => byName.has(name),
    plan(name, rawArguments, afterFiles) {
      const entry = byName.get(name);
      if (!entry) throw new FolderError("That tool is not available here.");
      const { connection, tool } = entry;
      const args = parseArguments(rawArguments);
      const key = `${connection.id}:${tool.name}`;
      const planned: PlannedCall = {
        label: `Used ${tool.name} on ${connection.name}`,
        doing: `Asking ${connection.name} (${tool.name})`,
        run: async () => {
          try {
            const text = await call(connection, tool.name, args);
            return `From the connection “${connection.name}”:\n${text}`;
          } catch (error) {
            throw error instanceof FolderError
              ? error
              : new FolderError(
                  error instanceof McpError
                    ? error.message
                    : "That did not work.",
                );
          }
        },
      };
      const card = {
        title: `Use ${tool.name} on ${connection.name}`,
        detail: [
          `Connection: ${connection.name}`,
          `Tool: ${tool.name}`,
          ...argumentLines(args),
        ].join("\n"),
      };
      if (!tool.readOnly) {
        return {
          ...planned,
          ask: {
            ...card,
            why: "This tool may change things on the connection, or the connection does not say it only reads. It asks every time.",
          },
        };
      }
      if (allowed.has(key)) {
        if (!afterFiles) return planned;
        return {
          ...planned,
          ask: {
            ...card,
            why: "It has read from your folders or looked at your screen in this answer, and these arguments can carry text out. Check they hold nothing private.",
          },
        };
      }
      return {
        ...planned,
        ask: {
          ...card,
          why: "This assistant has not used this read before.",
          remember: { connectionId: connection.id, tool: tool.name },
        },
      };
    },
    remember(connectionId, toolName) {
      const found = [...byName.values()].find(
        (e) => e.connection.id === connectionId && e.tool.name === toolName,
      );
      // Only a tool marked as a read is ever remembered.
      if (!found?.tool.readOnly) return;
      allowed.add(`${connectionId}:${toolName}`);
      persist(connectionId, toolName);
    },
  };
}

/** What the page may see of a saved connection: never a schema, never a key. */
export function showConnection(
  connection: StoredConnection,
  hasKey: boolean,
): Connection {
  return {
    id: connection.id,
    name: connection.name,
    preset: presetOf(connection),
    baseUrl: connection.baseUrl,
    hasKey,
    tools: connection.tools.map(showTool),
    checkedAt: connection.checkedAt,
  };
}

function showTool(tool: StoredTool): ConnectionTool {
  return {
    name: tool.name,
    description: tool.description,
    readOnly: tool.readOnly,
  };
}

export interface ServiceDeps {
  store: Store;
  secrets: Secrets;
  appVersion?: string;
  fetchImpl?: typeof fetch;
}

/** Checking, saving and removing connections, and making calls on them. */
export class ConnectionService {
  constructor(private readonly deps: ServiceDeps) {}

  private client(
    baseUrl: string,
    apiKey: string | undefined,
    preset: ConnectionPreset,
    signal?: AbortSignal,
  ): McpClient {
    const composio = preset === "composio";
    return new McpClient({
      // The Composio preset has one address and one header, whatever is saved.
      baseUrl: composio ? COMPOSIO_MCP_URL : baseUrl,
      keyStyle: composio ? "composio" : "bearer",
      ...(apiKey ? { apiKey } : {}),
      ...(signal ? { signal } : {}),
      ...(this.deps.appVersion ? { appVersion: this.deps.appVersion } : {}),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  /**
   * The key to use. One typed now is used as it is. A saved key is used only
   * for the address it was saved with, so a changed address never gets it.
   */
  private async keyFor(
    input: ConnectionInput,
    baseUrl: string,
  ): Promise<string | undefined> {
    const typed = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (typed) return typed;
    const before = input.id
      ? this.deps.store.connections().find((c) => c.id === input.id)
      : undefined;
    if (!before || before.baseUrl !== baseUrl) return undefined;
    return this.deps.secrets.get(before.id);
  }

  /**
   * A saved connection keeps the preset it was made with. The way in decides
   * it only for a new one, and an edit can never switch it.
   */
  private presetFor(
    input: { id?: string },
    entry: ConnectionPreset,
  ): ConnectionPreset {
    const before = input.id
      ? this.deps.store.connections().find((c) => c.id === input.id)
      : undefined;
    if (before && presetOf(before) !== entry)
      throw new Error("That connection was added another way. Edit it there.");
    return entry;
  }

  private async look(
    input: ConnectionInput,
    preset: ConnectionPreset,
  ): Promise<{
    baseUrl: string;
    key: string | undefined;
    tools: StoredTool[];
  }> {
    const baseUrl =
      preset === "composio"
        ? COMPOSIO_MCP_URL
        : checkEndpoint(typeof input.baseUrl === "string" ? input.baseUrl : "");
    const key = await this.keyFor(input, baseUrl);
    if (preset === "composio" && !key)
      throw new Error(
        "Composio needs your key. Copy it from your Composio account.",
      );
    const found = await this.client(baseUrl, key, preset).listTools();
    return {
      baseUrl,
      key,
      tools: found.map((t) => ({
        name: t.name,
        description: t.description,
        readOnly: t.readOnly,
        inputSchema: t.inputSchema,
      })),
    };
  }

  /** Connects and lists the tools. Saves nothing. */
  async check(
    input: ConnectionInput,
    entry: ConnectionPreset = "custom",
  ): Promise<ConnectionTool[]> {
    const preset = this.presetFor(input, entry);
    return (await this.look(input, preset)).tools.map(showTool);
  }

  /** The Composio way in: the address is fixed here, the page gives none. */
  checkComposio(input: ComposioInput): Promise<ConnectionTool[]> {
    return this.check({ ...input, baseUrl: COMPOSIO_MCP_URL }, "composio");
  }

  saveComposio(input: ComposioInput): Promise<Connection> {
    return this.save({ ...input, baseUrl: COMPOSIO_MCP_URL }, "composio");
  }

  async save(
    input: ConnectionInput,
    entry: ConnectionPreset = "custom",
  ): Promise<Connection> {
    const preset = this.presetFor(input, entry);
    const name = plain(input.name, 40);
    if (!name) throw new Error("Give the connection a name.");
    const typed = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    const before = input.id
      ? this.deps.store.connections().find((c) => c.id === input.id)
      : undefined;
    // The tools are read from the server now: nothing the page sends is kept.
    const { baseUrl, tools } = await this.look(input, preset);
    const saved = this.deps.store.saveConnection({
      ...(before ? { id: before.id } : {}),
      name,
      baseUrl,
      preset,
      tools,
    });
    try {
      // A saved key only ever goes to the address it was saved with.
      if (before && before.baseUrl !== saved.baseUrl && !typed)
        this.deps.secrets.remove(saved.id);
      if (typed) await this.deps.secrets.set(saved.id, typed);
    } catch (error) {
      if (!before) this.deps.store.removeConnection(saved.id);
      throw error;
    }
    return showConnection(saved, this.deps.secrets.has(saved.id));
  }

  remove(id: string): void {
    this.deps.store.removeConnection(id);
    this.deps.secrets.remove(id);
  }

  /** The tools of the page's list, with whether each one has a key saved. */
  list(): Connection[] {
    return this.deps.store
      .connections()
      .map((c) => showConnection(c, this.deps.secrets.has(c.id)));
  }

  /**
   * The gate for one answer. Each connection gets one client for the answer,
   * made when it is first called, with the key read then and held only here.
   */
  gateFor(assistant: Assistant, signal: AbortSignal): McpGate | undefined {
    const clients = new Map<string, McpClient>();
    const call: CallTool = async (connection, tool, args) => {
      let client = clients.get(connection.id);
      if (!client) {
        client = this.client(
          connection.baseUrl,
          await this.deps.secrets.get(connection.id),
          presetOf(connection),
          signal,
        );
        clients.set(connection.id, client);
      }
      return client.callTool(tool, args);
    };
    return buildGate(
      assistant,
      this.deps.store.connections(),
      call,
      (id, tool) => {
        this.deps.store.allowTool(assistant.id, id, tool);
      },
    );
  }
}
