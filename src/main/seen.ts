import type { ImagePart } from "./models";

/**
 * What one answer has seen so far. A flag set to true means the answer now
 * holds text from outside the person's own message: from somewhere private
 * (the person's folders or a file they attached, their screen, a mailbox, a
 * connection, another assistant), which an address or a tool's arguments
 * could carry out, or from somewhere that may be telling it what to do (a web
 * page, its own computer). Later calls that reach outside ask again.
 *
 * Flags are carried by name, so a flag added later is carried too: into an
 * assistant that is asked a question, and back out of it.
 */
export interface Seen {
  /** Set once this answer has read from the person's folders or attachments. */
  files: boolean;
  /** Set once this answer has looked at the screen. */
  screen: boolean;
  /** Set once this answer has read the person's mail. */
  mail: boolean;
  /**
   * Set once this answer has seen its own computer's screen or a command's
   * output there: outside text, which may come from a web page.
   */
  computer?: boolean;
  /** Set once this answer has read a web page: outside text, but public. */
  web?: boolean;
  /** Set once this answer has had a result from one of its connections. */
  connection?: boolean;
  /** Set once this answer has asked another assistant. */
  assistant?: boolean;
  /** The picture the last call made, taken by the loop right after it. */
  picture?: ImagePart;
  [flag: string]: boolean | ImagePart | undefined;
}

/**
 * Why later calls ask again, strongest first. Every private kind holds text
 * an address or arguments could carry out. "computer" and "web" are outside
 * text that may steer the assistant but holds nothing of the person's own.
 * "other" is a flag this list does not know yet, counted as private so a
 * kind of reading added later is never let through.
 */
export type SeenKind =
  | "screen"
  | "mail"
  | "files"
  | "connection"
  | "assistant"
  | "other"
  | "computer"
  | "web";

const PRIVATE_ORDER = [
  "screen",
  "mail",
  "files",
  "connection",
  "assistant",
] as const;
/** Outside text that holds nothing private by itself. */
const STEERING_ONLY = new Set<string>(["computer", "web"]);
const KNOWN = new Set<string>([...PRIVATE_ORDER, ...STEERING_ONLY]);

export function newSeen(): Seen {
  return { files: false, screen: false, mail: false };
}

/**
 * The strongest reason this answer has to ask again, or false when it has
 * read nothing from outside. Flags named in `except` are left out, such as
 * "mail" for a mail read, which is no new way for mail to get out.
 */
export function seenKind(seen: Seen, except: string[] = []): SeenKind | false {
  const set = (flag: string) => seen[flag] === true && !except.includes(flag);
  for (const flag of PRIVATE_ORDER) if (set(flag)) return flag;
  const unknown = Object.keys(seen).some(
    (flag) => !KNOWN.has(flag) && flag !== "picture" && set(flag),
  );
  if (unknown) return "other";
  if (set("computer")) return "computer";
  if (set("web")) return "web";
  return false;
}

/**
 * The strongest private reason, or false when the answer has read nothing
 * private: a web page or its own computer alone does not count.
 */
export function privateKind(
  seen: Seen,
  except: string[] = [],
): Exclude<SeenKind, "computer" | "web"> | false {
  const kind = seenKind(seen, [...except, ...STEERING_ONLY]);
  return kind === "computer" || kind === "web" ? false : kind;
}

/** The start of a card's "Why it asks" line for each kind. */
export function whyAfter(kind: SeenKind): string {
  switch (kind) {
    case "screen":
      return "It looked at your screen in this answer";
    case "mail":
      return "It has read your mail in this answer";
    case "files":
      return "It has read from your folders in this answer";
    case "connection":
      return "It has read what one of its connections sent in this answer";
    case "assistant":
      return "It asked another assistant in this answer";
    case "other":
      return "It has read something private in this answer";
    case "computer":
      return "It used its own computer in this answer, and what it read there may be telling it what to do";
    case "web":
      return "It read a web page in this answer, and what it read may be telling it what to do";
  }
}

/** A new `Seen` holding the same flags, and no picture. */
export function copyFlags(from: Seen): Seen {
  const copy = newSeen();
  carryFlags(from, copy);
  return copy;
}

/** Sets every flag that is true in `from`. A flag is never taken back. */
export function carryFlags(from: Seen, to: Seen): void {
  for (const [key, value] of Object.entries(from)) {
    if (value === true) to[key] = true;
  }
}
