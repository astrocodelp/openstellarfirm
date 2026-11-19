import { LATEST_RELEASE_API } from "../shared/links";
import type { Settings } from "../shared/types";
import {
  isNewer,
  shouldNotify,
  type UpdateCheck,
  versionOfTag,
} from "../shared/update";

/**
 * The update check. It only looks: it never downloads or installs anything.
 * The person's Download opens the file in their browser and they install it
 * as they did the first time. Installing by itself (electron-updater) waits
 * for signed builds: an unsigned update cannot be checked before it runs.
 *
 * What it sends: one GET to GitHub's "latest release" address for this
 * project, with an Accept header and a User-Agent of `OpenStellarFirm/<version>`.
 * No key, no cookie, nothing about the person. GitHub sees the network address,
 * as any website does. What it reads: only `tag_name` of the answer.
 */

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** The shortest wait before a launch asks again, so quick restarts ask once. */
export const LAUNCH_GAP_MS = 10 * 60 * 1000;
export const LAUNCH_DELAY_MS = 8000;
const HOURLY_MS = 60 * 60 * 1000;
export const MAX_ANSWER_BYTES = 256 * 1024;
export const DEADLINE_MS = 8000;

/** True when the last check was longer ago than `wait` (a day), or there was none. */
export function isDue(
  lastCheck: string | undefined,
  now: Date,
  wait: number = CHECK_EVERY_MS,
): boolean {
  if (!lastCheck) return true;
  const last = Date.parse(lastCheck);
  if (Number.isNaN(last)) return true;
  // A clock that went backwards must not stop the checks for good.
  return now.getTime() - last >= wait || last > now.getTime();
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
        "User-Agent": `OpenStellarFirm/${currentVersion}`,
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

/**
 * Why a check runs. "manual" is the person's own click on "Check now", which
 * works whether automatic checks are on or off. "launch" is the one look
 * shortly after the app starts, and "daily" the look while it stays open; both
 * need the switch on.
 */
export type CheckReason = "manual" | "launch" | "daily";

export interface UpdateCheckerDeps {
  fetch: typeof fetch;
  now(): Date;
  /** This app's own version. */
  version: string;
  settings(): Settings;
  /** Keeps when the check ran and what it found (null forgets a version). */
  record(at: Date, newest?: string | null): void;
  /** Keeps the newest version the person was told about. */
  markNotified?(version: string): void;
  /** Shows the system notice for a new version. */
  notify?(version: string): void;
  deadlineMs?: number;
}

export class UpdateChecker {
  private flying: Promise<UpdateCheck> | null = null;
  /** The look after start happens at most once in a run of the app. */
  private launched = false;

  constructor(private readonly deps: UpdateCheckerDeps) {}

  /** Returns null when it made no call. */
  async check(reason: CheckReason): Promise<UpdateCheck | null> {
    if (reason === "launch") {
      if (this.launched) return null;
      this.launched = true;
    }
    if (reason !== "manual") {
      const settings = this.deps.settings();
      if (!settings.checkUpdates) return null;
      // At launch the daily limit does not apply, but a restart soon after a
      // check (a crash, a quick quit and open) asks nothing again.
      const wait = reason === "launch" ? LAUNCH_GAP_MS : CHECK_EVERY_MS;
      if (!isDue(settings.lastUpdateCheck, this.deps.now(), wait)) return null;
    }
    this.flying ??= this.look(reason).finally(() => {
      this.flying = null;
    });
    return this.flying;
  }

  private async look(reason: CheckReason): Promise<UpdateCheck> {
    const found = await lookForUpdate(
      this.deps.fetch,
      this.deps.version,
      this.deps.deadlineMs,
    );
    // Whatever happened, the time is kept: a wait follows any attempt.
    // A disk that cannot be written to is no reason to tell the person.
    try {
      const at = this.deps.now();
      if (found.status === "newer") this.deps.record(at, found.version);
      else if (found.status === "current") this.deps.record(at, null);
      else this.deps.record(at);
    } catch {
      // The next check simply runs again.
    }
    if (found.status === "newer") this.tell(found.version, reason);
    return found;
  }

  /**
   * A version is told once. A click on "Check now" shows its answer on the
   * screen, so it counts as told without a system notice.
   */
  private tell(version: string, reason: CheckReason): void {
    try {
      const settings =
        reason === "manual"
          ? { ...this.deps.settings(), checkUpdates: true, updateNotify: true }
          : this.deps.settings();
      if (!shouldNotify(settings, version, this.deps.version)) return;
      // Kept first: a disk that cannot keep it would tell the person again at
      // every start, so then nothing is shown.
      this.deps.markNotified?.(version);
      if (reason !== "manual") this.deps.notify?.(version);
    } catch {
      // A notice that cannot be shown is no reason to fail the check.
    }
  }
}

/**
 * Once a few seconds after start, then a look every hour at whether a day has
 * passed (reading the settings only, no call). Never blocks the window, and
 * never keeps the app from quitting.
 */
export function scheduleUpdateChecks(
  checker: UpdateChecker,
  timers: {
    setTimeout: typeof setTimeout;
    setInterval: typeof setInterval;
  } = { setTimeout, setInterval },
): void {
  const run = (reason: CheckReason) => () =>
    void checker.check(reason).catch(() => undefined);
  timers.setTimeout(run("launch"), LAUNCH_DELAY_MS).unref?.();
  timers.setInterval(run("daily"), HOURLY_MS).unref?.();
}
