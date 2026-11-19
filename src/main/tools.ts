import type { Assistant } from "../shared/types";
import { fitsCard } from "../shared/visible-text";
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
import { type SeenKind, whyAfter } from "./seen";
import { checkWebAddress, readWebPage, type WebDeps, WebError } from "./web";

/**
 * The tools an assistant has, and the one rule about which of them ask.
 *
 * Reading a picked folder runs on its own: the person picked the folder.
 * Saving a new file there runs on its own too, since nothing is ever
 * replaced, except a file that runs or builds on its own (a script, a
 * Makefile, a project file) and any save once the answer has read outside
 * text, which ask. Reaching a website asks first, because an address can
 * carry text out of this computer. A site the person chose to always allow is
 * read without asking, unless the address carries extra text after a "?",
 * the answer has read something private, or, after a web page or its own
 * computer, the address is more than the site's bare address.
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
  /**
   * What an "always allow" would remember: one read of one connection, or
   * reading one mail account.
   */
  remember?: { connectionId: string; tool: string } | { mailAccountId: string };
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
   * What this answer has read from outside so far (`seenKind`), or false for
   * nothing. True stands for "files". Private text can be carried out by an
   * address; a web page or its own computer may be telling it what to do.
   */
  seenSoFar: SeenKind | boolean = false,
): PlannedCall {
  const after: SeenKind | false = seenSoFar === true ? "files" : seenSoFar;
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
    const planned: PlannedCall = {
      label: `Saved ${file}`,
      doing: `Saving ${file}`,
      run: () => saveNewFile(folders, args.path, args.content),
    };
    const runs = typeof args.path === "string" && runsOnItsOwn(args.path);
    if (!runs && !after) return planned;
    const detail = saveDetail(args.path, args.content);
    if (!fitsCard(detail))
      throw new FolderError(
        "That file is too long to show in full for the person's Approve, so it was not saved. Save it in smaller files.",
      );
    return {
      ...planned,
      ask: {
        title: `Save ${file} in your folder`,
        detail,
        why: runs
          ? "A file with this name can run or build on its own, from a program or a tool that opens the folder. Check it is one you want. Nothing in your folder is replaced."
          : `${whyAfter(after as SeenKind)}, and what it read could be telling it what to write. Check the file is one you want. Nothing in your folder is replaced.`,
      },
    };
  }

  const url = checkWebAddress(args.url);
  const site = siteOf(url.hostname);
  const allowed = assistant.sites.includes(site);
  const carriesText = url.search.length > 0;
  // The site itself, with nothing after it that could carry text.
  const bare = !carriesText && (url.pathname === "/" || url.pathname === "");
  const planned: PlannedCall = {
    label: `Read ${site}`,
    doing: `Reading ${site}`,
    run: () => readWebPage(url.href, web),
  };
  const steered = after === "web";
  if (allowed && !carriesText && !after) return planned;
  if (allowed && bare && steered) return planned;
  if (after && (!steered || allowed)) {
    // An allowed site is still asked for here: the answer now holds outside
    // text, and any part of an address can carry text out.
    return {
      ...planned,
      ask: {
        title: `Read a page on ${site}`,
        detail: url.href,
        why:
          after === "computer"
            ? `${whyAfter(after)}. Check the address is one you expect.`
            : steered
              ? `${whyAfter(after)}. Anything after the site's name can carry text out, so check the address is one you expect.`
              : `${whyAfter(after)}, and an address can carry text out. Check the address holds nothing private.`,
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

/**
 * File names and endings that a program or a tool runs or builds from on its
 * own, once they sit in a folder: scripts, build and project files, test
 * set-ups, container files. A save of one asks, so a page or a file cannot
 * plant something that runs the next time the person opens the folder.
 */
const RUNS_ON_ITS_OWN_NAMES = new Set([
  "makefile",
  "gnumakefile",
  "justfile",
  "rakefile",
  "gemfile",
  "podfile",
  "vagrantfile",
  "procfile",
  "dockerfile",
  "containerfile",
  "jenkinsfile",
  "brewfile",
  "build",
  "workspace",
  "package.json",
  "package-lock.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "deno.json",
  "deno.jsonc",
  "bunfig.toml",
  "tsconfig.json",
  "jsconfig.json",
  "vite.config.js",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "pipfile",
  "tox.ini",
  "noxfile.py",
  "conftest.py",
  "sitecustomize.py",
  "usercustomize.py",
  "__init__.py",
  "__main__.py",
  "manage.py",
  "cargo.toml",
  "build.rs",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradlew",
  "mvnw",
  "build.xml",
  "cmakelists.txt",
  "meson.build",
  "configure",
  "directory.build.props",
  "directory.build.targets",
  "directory.packages.props",
  "nuget.config",
  "global.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "autorun.inf",
  "desktop.ini",
]);

const RUNS_ON_ITS_OWN_ENDINGS = [
  // Scripts and programs.
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".command",
  ".tool",
  ".bat",
  ".cmd",
  ".ps1",
  ".psm1",
  ".psd1",
  ".vbs",
  ".vbe",
  ".js",
  ".mjs",
  ".cjs",
  ".jse",
  ".wsf",
  ".wsh",
  ".hta",
  ".msc",
  ".scr",
  ".pif",
  ".exe",
  ".com",
  ".msi",
  ".dll",
  ".lnk",
  ".url",
  ".desktop",
  ".app",
  ".appimage",
  ".jar",
  ".py",
  ".pyw",
  ".pth",
  ".rb",
  ".pl",
  ".php",
  ".applescript",
  ".scpt",
  ".workflow",
  ".reg",
  ".inf",
  ".service",
  ".plist",
  // Pages that run script when opened, and Office files that carry macros.
  ".html",
  ".htm",
  ".xhtml",
  ".xht",
  ".mht",
  ".mhtml",
  ".svg",
  ".svgz",
  ".docm",
  ".dotm",
  ".xlsm",
  ".xltm",
  ".xlam",
  ".xla",
  ".pptm",
  ".potm",
  ".ppam",
  ".ppsm",
  ".sldm",
  ".jnlp",
  ".chm",
  ".iqy",
  ".slk",
  ".vsto",
  // Build and project files.
  ".csproj",
  ".vbproj",
  ".fsproj",
  ".vcxproj",
  ".sln",
  ".props",
  ".targets",
  ".mk",
  ".cmake",
  ".gradle",
  ".kts",
  ".code-workspace",
  ".sublime-project",
  ".xcodeproj",
  ".pbxproj",
];

/** True when a file with this name runs or builds on its own in a folder. */
export function runsOnItsOwn(path: string): boolean {
  const name = (
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .at(-1) ?? ""
  )
    .replace(/[. ]+$/, "")
    .toLowerCase();
  if (!name) return false;
  if (RUNS_ON_ITS_OWN_NAMES.has(name)) return true;
  // vite.config.ts, jest.config.mjs, webpack.config.cjs and the like.
  if (/\.config\.[a-z]+$/.test(name)) return true;
  if (/^docker-compose\..+\.ya?ml$/.test(name)) return true;
  if (/^(dockerfile|containerfile)\./.test(name)) return true;
  return RUNS_ON_ITS_OWN_ENDINGS.some((ending) => name.endsWith(ending));
}

/** What a save would write, in full, for its card. */
function saveDetail(path: unknown, content: unknown): string {
  const where = typeof path === "string" ? path.trim() : "";
  const text = typeof content === "string" ? content : "";
  return `${where}\n\n${text}`;
}

/** Turns anything a tool threw into a sentence the model can act on. */
export function toolFailure(error: unknown): string {
  if (error instanceof FolderError || error instanceof WebError)
    return error.message;
  return "That did not work.";
}
