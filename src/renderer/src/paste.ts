/**
 * What a paste into the message box is: words or files. Pure, so the rule can
 * be tested without a page.
 */

/** The parts of a clipboard the rule reads. */
export interface ClipboardLike {
  files: ArrayLike<{ type: string; name: string }>;
  getData(format: string): string;
}

/**
 * Whether a paste should become files rather than text.
 *
 * Excel, PowerPoint, OneNote and others copy a picture of the selection beside
 * its words: that paste is the words. A screenshot has no words: it is a
 * file. A file copied in Finder or Explorer carries at most its own name as
 * text, and anything that is not a picture is always a file.
 */
export function pasteIsFiles(clipboard: ClipboardLike | null): boolean {
  if (!clipboard || clipboard.files.length === 0) return false;
  const files = Array.from(clipboard.files);
  if (!files.every((file) => file.type.startsWith("image/"))) return true;
  const text = clipboard.getData("text/plain").trim();
  if (!text) return true;
  const names = new Set(files.map((file) => file.name));
  return text.split(/\r?\n/).every((line) => names.has(line.trim()));
}
