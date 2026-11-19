import { LATEST_RELEASE_API } from "../shared/links";
import type { Settings } from "../shared/types";
import { isNewer, type UpdateCheck, versionOfTag } from "../shared/update";

/**
 * The update check. It only looks: it never downloads or installs anything.
 *
 * What it sends: one GET to GitHub's "latest release" address for this
 * project, with an Accept header and a User-Agent of `StellarFirm-Solo/<version>`.
 * No key, no cookie, nothing about the person. GitHub sees the network address,
 * as any website does. What it reads: only `tag_name` of the answer.
 */

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
export const MAX_ANSWER_BYTES = 256 * 1024;
export const DEADLINE_MS = 8000;

/** True when the last check was more than a day ago, or there was none. */
export function isDue(lastCheck: string | undefined, now: Date): boolean {
  if (!lastCheck) return true;
  const last = Date.parse(lastCheck);
  if (Number.isNaN(last)) return true;
  // A clock that went backwards must not stop the checks for good.
  return now.getTime() - last >= CHECK_EVERY_MS || last > now.getTime();
}

/** Reads the body, and gives up on anything past the cap. */
async function readCapped(
  response: Response,
  max: number,
): Promise<string | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > max) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** One look at the newest release. Never throws: every failure is "unknown". */
export async function lookForUpdate(
  fetchFn: typeof fetch,
  currentVersion: string,
  deadlineMs: number = DEADLINE_MS,
): Promise<UpdateCheck> {
  try {
    const response = await fetchFn(LATEST_RELEASE_API, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `StellarFirm-Solo/${currentVersion}`,
      },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(deadlineMs),
    });
    // No release has been published yet: nothing newer exists.
    if (response.status === 404) return { status: "current" };
    if (!response.ok || response.redirected) return { status: "unknown" };
    const body = await readCapped(response, MAX_ANSWER_BYTES);
    if (body === null) return { status: "unknown" };
    const answer: unknown = JSON.parse(body);
    if (typeof answer !== "object" || answer === null)
      return { status: "unknown" };
    const version = versionOfTag((answer as { tag_name?: unknown }).tag_name);
    if (!version) return { status: "unknown" };
    return isNewer(version, currentVersion)
      ? { status: "newer", version }
      : { status: "current" };
  } catch {
    return { status: "unknown" };
  }
}

export interface UpdateCheckerDeps {
  fetch: typeof fetch;
  now(): Date;
  /** This app's own version. */
  version: string;
  settings(): Settings;
  /** Keeps when the check ran and what it found (null forgets a version). */
  record(at: Date, newest?: string | null): void;
  deadlineMs?: number;
}

export class UpdateChecker {
  private flying: Promise<UpdateCheck> | null = null;

  constructor(private readonly deps: UpdateCheckerDeps) {}

  /**
   * `manual` is the person's own click on "Check now", which works whether the
   * switch is on or off. A scheduled run (`false`) makes no call unless the
   * switch is on and a day has passed. Returns null when it made no call.
   */
  async check(manual: boolean): Promise<UpdateCheck | null> {
    if (!manual) {
      const settings = this.deps.settings();
      if (!settings.checkUpdates) return null;
      if (!isDue(settings.lastUpdateCheck, this.deps.now())) return null;
    }
    this.flying ??= this.look().finally(() => {
      this.flying = null;
    });
    return this.flying;
  }

  private async look(): Promise<UpdateCheck> {
    const found = await lookForUpdate(
      this.deps.fetch,
      this.deps.version,
      this.deps.deadlineMs,
    );
    // Whatever happened, the time is kept: a day's wait follows any attempt.
    // A disk that cannot be written to is no reason to tell the person.
    try {
      const at = this.deps.now();
      if (found.status === "newer") this.deps.record(at, found.version);
      else if (found.status === "current") this.deps.record(at, null);
      else this.deps.record(at);
    } catch {
      // The next check simply runs again.
    }
    return found;
  }
}

/**
 * A few seconds after start, then every few hours. The daily limit is in
 * `check`, so a long-running app still asks only once a day. Never blocks the
 * window, and never keeps the app from quitting.
 */
export function scheduleUpdateChecks(checker: UpdateChecker): void {
  const run = () => void checker.check(false).catch(() => undefined);
  setTimeout(run, 8000).unref();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
