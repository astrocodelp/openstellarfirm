/**
 * What a model has shown it cannot take, learned in this run of the app.
 *
 * Once a model source and model refused a picture or a PDF, the next messages
 * to it go straight to text read on this computer, the way text-tools
 * remembers a model that cannot call tools. Nothing here is saved: a restart
 * tries again, in case the model was changed.
 */

export type FileMode = "picture" | "pdf";

const refused = new Set<string>();

function keyOf(key: string, mode: FileMode): string {
  return `${mode}\n${key}`;
}

export function cannotRead(key: string | undefined, mode: FileMode): boolean {
  return key !== undefined && refused.has(keyOf(key, mode));
}

export function rememberCannotRead(
  key: string | undefined,
  mode: FileMode,
): void {
  if (key !== undefined) refused.add(keyOf(key, mode));
}

/** For tests: forget what was learned about models. */
export function forgetFileModes(): void {
  refused.clear();
}
