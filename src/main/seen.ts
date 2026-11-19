import type { ImagePart } from "./models";

/**
 * What one answer has seen so far. A flag set to true means the answer now
 * holds text from somewhere private (the person's folders, their screen, a
 * mailbox), which an address or a tool's arguments could carry out, so later
 * calls that reach outside ask again.
 *
 * Flags are carried by name, so a flag added later is carried too: into an
 * assistant that is asked a question, and back out of it.
 */
export interface Seen {
  /** Set once this answer has read from the person's folders. */
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
  /** The picture the last call made, taken by the loop right after it. */
  picture?: ImagePart;
  [flag: string]: boolean | ImagePart | undefined;
}

export function newSeen(): Seen {
  return { files: false, screen: false, mail: false };
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
