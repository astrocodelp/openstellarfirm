import {
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";

/**
 * The folder tools: what an assistant can do in the folders the person picked.
 *
 * It can list, find, read, and save a NEW file. There is no way to change,
 * replace, move or delete anything: no function here does it. Every path is
 * checked after links are followed, so a link cannot lead outside a folder,
 * and every part of the real path is checked again: a file or folder whose
 * name starts with a dot (settings, keys, history, a tool's sign-in) and a
 * file that holds keys or passwords are never shown, read or written, even
 * when a link with a plain name points at one.
 */

export class FolderError extends Error {}

const SECRET_NAMES = [
  /^\.env/i,
  /^\.ssh$/i,
  /^\.aws$/i,
  /^\.gnupg$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|p12|pfx|p8|ppk|jks|keystore|kdbx|keychain|keychain-db|ovpn|gpg)$/i,
  /^credentials(\.json)?$/i,
  /^secrets?(\.|$)/i,
  /^kubeconfig$/i,
  /^known_hosts$/i,
  /^authorized_keys$/i,
  /^htpasswd$/i,
  /^wallet\.dat$/i,
  /^service[-_]?account.*\.json$/i,
  /_history$/i,
];

/**
 * The only names that start with a dot and may be read: plain settings for
 * how a project's files are written, which hold no keys. Every other one
 * (.config, .kube, .docker, .pgpass, .pypirc, .vault-token, .bash_history,
 * .git, ...) is left out, because a tool's settings and sign-ins live there.
 * Nothing starting with a dot is ever written.
 */
const READABLE_DOT_NAMES = new Set([
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
]);
const SKIPPED_FOLDERS = new Set(["node_modules", ".git"]);
const MAX_READ_BYTES = 1024 * 1024;
const MAX_READ_CHARS = 60_000;
const MAX_WRITE_CHARS = 512 * 1024;
const MAX_WRITE_BYTES = 25 * 1024 * 1024;

export function isSecretName(name: string): boolean {
  // Windows drops trailing dots and spaces, so "id_rsa." is the same file.
  const bare = name.replace(/[. ]+$/, "");
  return SECRET_NAMES.some((pattern) => pattern.test(bare));
}

/**
 * True when a part of a path may not be read: a secret's name, or a name
 * that starts with a dot and is not one of the few plain settings files.
 */
export function isHiddenName(name: string): boolean {
  if (isSecretName(name)) return true;
  const bare = name.replace(/[. ]+$/, "");
  return name.startsWith(".") && !READABLE_DOT_NAMES.has(bare.toLowerCase());
}

const HIDDEN_PART =
  "That file is private or holds settings, so it is not opened.";

/** The name a model uses for each folder: its last part, made unique. */
export function folderLabels(
  folders: string[],
): { label: string; root: string }[] {
  const seen = new Map<string, number>();
  return folders.map((root) => {
    const base = basename(root) || root;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { label: count === 1 ? base : `${base} (${count})`, root };
  });
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

interface Located {
  root: string;
  full: string;
  /** The path as the model wrote it, cleaned, for labels and messages. */
  shown: string;
  parts: string[];
}

/**
 * Turns "Label/path/inside" into a real path, or says why it cannot. A save
 * checks names that start with a dot itself, more strictly.
 */
function locate(
  folders: string[],
  modelPath: unknown,
  forSave = false,
): Located {
  if (typeof modelPath !== "string" || !modelPath.trim()) {
    throw new FolderError("Name the folder and the path inside it.");
  }
  const labels = folderLabels(folders);
  if (labels.length === 0)
    throw new FolderError("No folder has been picked for this assistant.");
  const parts = modelPath
    .trim()
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".");
  if (parts.includes(".."))
    throw new FolderError("A path cannot go up out of the folder.");
  // A colon names a drive or a hidden stream on Windows; neither is a file here.
  if (parts.some((part) => part.includes(":") || part.includes("\u0000")))
    throw new FolderError("That is not a path inside the folder.");
  let found = labels.find((entry) => entry.label === parts[0]);
  if (found) parts.shift();
  // With one folder, a path that leaves its name out still means that folder.
  else if (labels.length === 1) found = labels[0];
  if (!found) {
    throw new FolderError(
      `Start the path with one of these folders: ${labels.map((entry) => entry.label).join(", ")}.`,
    );
  }
  if (parts.some(isSecretName)) {
    throw new FolderError(
      "That file can hold keys or passwords, so it is not opened.",
    );
  }
  if (!forSave && parts.some(isHiddenName)) throw new FolderError(HIDDEN_PART);
  return {
    root: found.root,
    full: join(found.root, ...parts),
    shown: [found.label, ...parts].join("/"),
    parts,
  };
}

/**
 * Checks a real path, after links were followed, against its folder's real
 * root: it must be inside, and no part of it, from the root down, may be a
 * hidden or secret name. So a link called "notes.txt" that points at
 * ".ssh/id_rsa" in the same folder is refused like the file itself.
 */
function checkReal(realRoot: string, real: string): void {
  if (!inside(realRoot, real))
    throw new FolderError("That path leads outside the folder.");
  const parts = relative(realRoot, real)
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.some(isHiddenName)) throw new FolderError(HIDDEN_PART);
}

/** The real path of something that exists, checked to be inside its folder. */
async function existing(at: Located): Promise<string> {
  let real: string;
  let realRoot: string;
  try {
    realRoot = await realpath(at.root);
    real = await realpath(at.full);
  } catch {
    throw new FolderError(`Nothing is there: ${at.shown}`);
  }
  checkReal(realRoot, real);
  return real;
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function listFolder(
  folders: string[],
  modelPath?: unknown,
): Promise<string> {
  if (modelPath === undefined || modelPath === null || modelPath === "") {
    const labels = folderLabels(folders);
    if (labels.length === 0)
      throw new FolderError("No folder has been picked for this assistant.");
    return labels.map((entry) => `${entry.label}/ (folder)`).join("\n");
  }
  const at = locate(folders, modelPath);
  const real = await existing(at);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(real, { withFileTypes: true });
  } catch {
    throw new FolderError(`That is a file, not a folder: ${at.shown}`);
  }
  const shown = entries
    .filter((entry) => !isHiddenName(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 200);
  const lines = await Promise.all(
    shown.map(async (entry) => {
      if (entry.isDirectory()) return `${entry.name}/ (folder)`;
      const info = await stat(join(real, entry.name)).catch(() => null);
      return info ? `${entry.name} (${size(info.size)})` : entry.name;
    }),
  );
  if (lines.length === 0) return "The folder is empty.";
  return entries.length > shown.length
    ? `${lines.join("\n")}\n(Only the first ${shown.length} are listed.)`
    : lines.join("\n");
}

export async function readFile(
  folders: string[],
  modelPath: unknown,
): Promise<string> {
  const at = locate(folders, modelPath);
  const real = await existing(at);
  const info = await stat(real);
  if (info.isDirectory())
    throw new FolderError(`That is a folder, not a file: ${at.shown}`);
  // A device or a pipe has no end to read to.
  if (!info.isFile())
    throw new FolderError("That is not an ordinary file, so it is not read.");
  if (info.size > MAX_READ_BYTES) {
    throw new FolderError(
      `That file is too large to read here (${size(info.size)}).`,
    );
  }
  const handle = await open(real, "r");
  let bytes: Buffer;
  try {
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.subarray(0, 8192).includes(0)) {
    throw new FolderError(
      "That file is not text, so it cannot be read here yet.",
    );
  }
  const text = bytes.toString("utf8");
  return text.length > MAX_READ_CHARS
    ? `${text.slice(0, MAX_READ_CHARS)}\n(The file goes on; only the first part is shown.)`
    : text;
}

export async function findFiles(
  folders: string[],
  query: unknown,
): Promise<string> {
  if (typeof query !== "string" || !query.trim()) {
    throw new FolderError("Say part of the file's name to look for.");
  }
  const want = query.trim().toLowerCase();
  const hits: string[] = [];
  let visited = 0;
  for (const { label, root } of folderLabels(folders)) {
    const realRoot = await realpath(root).catch(() => null);
    if (!realRoot) continue;
    const queue: { dir: string; shown: string; depth: number }[] = [
      { dir: realRoot, shown: label, depth: 0 },
    ];
    while (queue.length > 0 && hits.length < 50 && visited < 5000) {
      const next = queue.shift();
      if (!next) break;
      const entries = await readdir(next.dir, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        visited += 1;
        if (isHiddenName(entry.name) || entry.isSymbolicLink()) continue;
        const shown = `${next.shown}/${entry.name}`;
        if (entry.isDirectory()) {
          if (!SKIPPED_FOLDERS.has(entry.name) && next.depth < 6) {
            queue.push({
              dir: join(next.dir, entry.name),
              shown,
              depth: next.depth + 1,
            });
          }
        }
        if (entry.name.toLowerCase().includes(want) && hits.length < 50) {
          hits.push(entry.isDirectory() ? `${shown}/` : shown);
        }
      }
    }
  }
  return hits.length > 0
    ? hits.join("\n")
    : "Nothing with that in its name was found.";
}

/** Saves a new file. It never writes over a file that is already there. */
export async function saveNewFile(
  folders: string[],
  modelPath: unknown,
  content: unknown,
): Promise<string> {
  // Bytes come only from the main process (a file copied from an assistant's
  // own computer, after the person approved it); a model sends text.
  if (content instanceof Uint8Array) {
    if (content.length > MAX_WRITE_BYTES)
      throw new FolderError("That file is too large to save.");
  } else if (typeof content !== "string") {
    throw new FolderError("Give the text to save.");
  } else if (content.length > MAX_WRITE_CHARS) {
    throw new FolderError("That is too much text for one file.");
  }
  const at = locate(folders, modelPath, true);
  if (at.parts.length === 0) throw new FolderError("Give the new file a name.");
  // A name that starts with a dot is a settings file somewhere; none is made.
  if (at.parts.some((part) => part.startsWith("."))) {
    throw new FolderError("A name cannot start with a dot.");
  }
  const realRoot = await realpath(at.root).catch(() => {
    throw new FolderError("That folder is no longer there.");
  });
  // Check the deepest folder that already exists before making any new one.
  let anchor = dirname(at.full);
  for (;;) {
    const real = await realpath(anchor).catch(() => null);
    if (real) {
      // A folder reached through a link (into ".git/hooks", say) is refused
      // before anything is made in it.
      checkReal(realRoot, real);
      break;
    }
    const up = dirname(anchor);
    if (up === anchor) throw new FolderError("That folder is no longer there.");
    anchor = up;
  }
  await mkdir(dirname(at.full), { recursive: true });
  const realParent = await realpath(dirname(at.full));
  checkReal(realRoot, realParent);
  try {
    // "wx" fails when the file exists, so nothing is ever replaced.
    await writeFile(join(realParent, basename(at.full)), content, {
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FolderError(
        `There is already a file at ${at.shown}. Nothing was replaced. Pick another name.`,
      );
    }
    throw new FolderError("The file could not be saved there.");
  }
  return `Saved ${at.shown}`;
}

/** The last part of a path the model wrote, for a short label. */
export function shortName(modelPath: unknown): string {
  if (typeof modelPath !== "string") return "a file";
  const parts = modelPath.split(/[\\/]+/).filter(Boolean);
  return (parts.at(-1) ?? "a file").slice(0, 60);
}
