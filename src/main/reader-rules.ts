import { READER_ORIGIN } from "../shared/reading";

/**
 * The reader's small rules, kept apart from Electron so they are tested
 * offline: which paths its scheme serves, and what a failure says.
 */

const PART = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}";
const PATH = new RegExp(`^${PART}(/${PART}){0,1}$`);

/**
 * The path a reader address names, or undefined when it is not one of the
 * reader's own: another origin, a query, a fragment, a parent folder, an
 * encoded character or an odd name are all refused.
 */
export function readerPath(url: string): string | undefined {
  if (!url.startsWith(`${READER_ORIGIN}/`)) return undefined;
  // Checked before parsing, which would quietly fold a parent folder away.
  const raw = url.slice(READER_ORIGIN.length + 1);
  if (/\.\.|%|\\/.test(raw)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password)
    return undefined;
  const path = parsed.pathname.slice(1);
  if (!PATH.test(path) || path.includes("..")) return undefined;
  if (
    path.startsWith("lang/") &&
    !/^lang\/[a-z_]{3,10}\.traineddata$/.test(path)
  )
    return undefined;
  return path;
}

/**
 * What the person reads when the reader could not do a file. The reader only
 * sends an error's name, so nothing from inside a file reaches the screen.
 */
export function readerError(name: unknown): string {
  if (name === "PasswordException")
    return "That PDF is locked with a password, so it cannot be read.";
  if (name === "InvalidPDFException" || name === "FormatError")
    return "That PDF could not be read. It may be damaged.";
  if (name === "EncodingError" || name === "InvalidStateError")
    return "That picture could not be read. It may be damaged.";
  return "The reader on this computer could not read that file.";
}
