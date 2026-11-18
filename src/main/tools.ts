import type { Assistant } from "../shared/types";
import {
  FolderError,
  findFiles,
  listFolder,
  readFile,
  saveNewFile,
  shortName,
} from "./folders";
import type { ToolSpec } from "./models";
import { SCREEN_TOOL } from "./screen";
import { checkWebAddress, readWebPage, type WebDeps, WebError } from "./web";

/**
 * The tools an assistant has, and the one rule about which of them ask.
 *
 * Reading a picked folder and saving a new file there run on their own: the
 * person picked the folder, and nothing there is ever replaced. Reaching a
 * website asks first, because an address can carry text out of this computer.
 * A site the person chose to always allow is read without asking, unless the
 * address carries extra text after a "?", which asks every time.
 */

export type ToolAssistant = Pick<Assistant, "folders" | "web" | "sites"> & {
  screen?: boolean;
};

/** What a planned call needs from the person before it may run. */
export interface Ask {
  title: string;
  detail: string;
  why: string;
  /** The site an "always allow" would remember. */
  site?: string;
  /** The one read of one connection an "always allow" would remember. */
  remember?: { connectionId: string; tool: string };
}

export interface PlannedCall {
  /** A short past-tense line for the chat, such as "Read notes.md". */
  label: string;
  /** What the person sees while it runs, such as "Reading notes.md". */
  doing: string;
  ask?: Ask;
  run(): Promise<string>;
}

const text = { type: "string" } as const;

const FOLDER_TOOLS: ToolSpec[] = [
  {
    name: "list_folder",
    description:
      "List what is in a folder. With no path, lists the folders you may use.",
    parameters: {
      type: "object",
      properties: {
        path: { ...text, description: "Folder name, then the path inside it." },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a text file.",
    parameters: {
      type: "object",
      properties: {
        path: { ...text, description: "Folder name, then the path inside it." },
      },
      required: ["path"],
    },
  },
  {
    name: "find_files",
    description: "Find files and folders whose name contains some text.",
    parameters: {
      type: "object",
      properties: {
        name: { ...text, description: "Part of the name to look for." },
      },
      required: ["name"],
    },
  },
  {
    name: "save_new_file",
    description:
      "Save text as a new file. It never replaces a file: if the name is taken, pick another.",
    parameters: {
      type: "object",
      properties: {
        path: {
          ...text,
          description: "Folder name, then the new file's path inside it.",
        },
        content: { ...text, description: "The text to save." },
      },
      required: ["path", "content"],
    },
  },
];

const WEB_TOOL: ToolSpec = {
  name: "read_web_page",
  description:
    "Read a public web page as text, by its full https address. The person is asked first for a site that has not been allowed.",
  parameters: {
    type: "object",
    properties: {
      url: { ...text, description: "The page's full https address." },
    },
    required: ["url"],
  },
};

export function toolsFor(assistant: ToolAssistant): ToolSpec[] {
  return [
    ...(assistant.folders.length > 0 ? FOLDER_TOOLS : []),
    ...(assistant.web ? [WEB_TOOL] : []),
    ...(assistant.screen ? [SCREEN_TOOL] : []),
  ];
}

export function siteOf(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function parse(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    throw new FolderError(
      "The tool call was not written correctly. Try again.",
    );
  }
}

/**
 * Checks one tool call and says what running it means. It throws a plain
 * sentence when the call cannot be made at all; nothing has run by then.
 */
export function planCall(
  assistant: ToolAssistant,
  name: string,
  rawArguments: string,
  web?: WebDeps,
  /**
   * True once this answer has read from the person's folders, or "screen" once
   * it has looked at the screen: either can hold text that an address carries out.
   */
  afterFiles: boolean | "screen" = false,
): PlannedCall {
  const offered = toolsFor(assistant).some((tool) => tool.name === name);
  // The screen tool has its own path in the agent, which asks before it looks.
  if (!offered || name === SCREEN_TOOL.name)
    throw new FolderError("That tool is not available here.");
  const args = parse(rawArguments);
  const { folders } = assistant;

  if (name === "list_folder") {
    const where = args.path ? shortName(args.path) : "your folders";
    return {
      label: `Listed ${where}`,
      doing: `Listing ${where}`,
      run: () => listFolder(folders, args.path),
    };
  }
  if (name === "read_file") {
    const file = shortName(args.path);
    return {
      label: `Read ${file}`,
      doing: `Reading ${file}`,
      run: () => readFile(folders, args.path),
    };
  }
  if (name === "find_files") {
    const want = typeof args.name === "string" ? args.name.slice(0, 40) : "";
    return {
      label: `Looked for “${want}”`,
      doing: `Looking for “${want}”`,
      run: () => findFiles(folders, args.name),
    };
  }
  if (name === "save_new_file") {
    const file = shortName(args.path);
    return {
      label: `Saved ${file}`,
      doing: `Saving ${file}`,
      run: () => saveNewFile(folders, args.path, args.content),
    };
  }

  const url = checkWebAddress(args.url);
  const site = siteOf(url.hostname);
  const allowed = assistant.sites.includes(site);
  const carriesText = url.search.length > 0;
  const planned: PlannedCall = {
    label: `Read ${site}`,
    doing: `Reading ${site}`,
    run: () => readWebPage(url.href, web),
  };
  if (allowed && !carriesText && !afterFiles) return planned;
  if (afterFiles) {
    // An allowed site is still asked for here: the answer now holds text from
    // the person's files, and any part of an address can carry text out.
    return {
      ...planned,
      ask: {
        title: `Read a page on ${site}`,
        detail: url.href,
        why:
          afterFiles === "screen"
            ? "It looked at your screen in this answer, and an address can carry text out. Check the address holds nothing private."
            : "It has read from your folders in this answer, and an address can carry text out. Check the address holds nothing private.",
      },
    };
  }
  return {
    ...planned,
    ask: carriesText
      ? {
          title: `Read a page on ${site}`,
          detail: url.href,
          why: "This address carries extra text after the “?”. That text is sent to the site, so check it holds nothing private.",
        }
      : {
          title: `Read a page on ${site}`,
          detail: url.href,
          why: "This assistant has not read this site before.",
          site,
        },
  };
}

/** Turns anything a tool threw into a sentence the model can act on. */
export function toolFailure(error: unknown): string {
  if (error instanceof FolderError || error instanceof WebError)
    return error.message;
  return "That did not work.";
}
