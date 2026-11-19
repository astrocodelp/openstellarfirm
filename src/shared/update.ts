/**
 * Version rules for the update check. Pure: the check itself lives in the main
 * process. A version is only ever three plain numbers, and a link to a release
 * is built from those numbers, never from text in an answer.
 */

/** A GitHub release tag we accept: v1.2.3, and nothing else. */
const TAG = /^v(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const BARE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
/** The app's own version may carry a suffix, such as 0.2.0-dev. */
const OWN = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+].*)?$/;

type Triple = [number, number, number];

function triple(match: RegExpMatchArray | null): Triple | null {
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** "v1.2.3" becomes "1.2.3". Pre-releases and anything else are null. */
export function versionOfTag(tag: unknown): string | null {
  if (typeof tag !== "string") return null;
  return TAG.test(tag) ? tag.slice(1) : null;
}

/** A stored version such as "1.2.3", or null when it is anything else. */
export function cleanVersion(value: unknown): string | null {
  return typeof value === "string" && BARE.test(value) ? value : null;
}

/** Numeric comparison: 0.10.0 is newer than 0.9.9. Null when either is unreadable. */
export function compareVersions(a: string, b: string): number | null {
  const x = triple(a.match(OWN));
  const y = triple(b.match(OWN));
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isNewer(candidate: string, current: string): boolean {
  const order = compareVersions(candidate, current);
  return order !== null && order > 0;
}

/**
 * The version the person may be told about: newer than the one running, and
 * not one they dismissed. Read again every time, so an update installed since
 * the last check stops being announced.
 */
export function availableUpdate(
  settings: { newestVersion?: string; dismissedVersion?: string },
  current: string,
): string | null {
  const newest = cleanVersion(settings.newestVersion);
  if (!newest || !isNewer(newest, current)) return null;
  return settings.dismissedVersion === newest ? null : newest;
}

/**
 * Whether an automatic check that found `version` should show a system notice:
 * checks and notices are on, the version is newer than the one running and
 * than any the person was told about, and it is not one they dismissed. So a
 * version is told once, and never again after a restart.
 */
export function shouldNotify(
  settings: {
    checkUpdates?: boolean;
    updateNotify?: boolean;
    dismissedVersion?: string;
    notifiedVersion?: string;
  },
  version: string,
  current: string,
): boolean {
  if (settings.checkUpdates !== true || settings.updateNotify === false)
    return false;
  const clean = cleanVersion(version);
  if (!clean || !isNewer(clean, current)) return false;
  if (settings.dismissedVersion === clean) return false;
  const told = cleanVersion(settings.notifiedVersion);
  return !told || isNewer(clean, told);
}

/**
 * The words of the system notice. Built from the clean version only, so no
 * text from an answer reaches the notice.
 */
export function updateOutNotice(version: string): {
  title: string;
  body: string;
} {
  const clean = cleanVersion(version);
  if (!clean) throw new Error("That is not a version.");
  return {
    title: `OpenStellarFirm ${clean} is out`,
    body: "Open it to download the new version.",
  };
}

/** What a check found. "unknown" covers every way it could not tell. */
export type UpdateCheck =
  | { status: "newer"; version: string }
  | { status: "current" }
  | { status: "unknown" };
