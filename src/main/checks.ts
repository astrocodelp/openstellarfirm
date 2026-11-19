import { type CheckSettings, cleanLookFor } from "../shared/checks";
import type { CheckCounters } from "./store";

/**
 * The main assistant's checks, on a schedule, while the app is open.
 *
 * A check is one answer in the main assistant's own chat, started by the app.
 * It only reads: that rule is in the agent loop (`readOnly`), and this file
 * only decides when one may start. Nothing here runs a tool or answers a card.
 */

/** Checks that may start in one day, the person's own clicks included. */
export const MAX_CHECKS_A_DAY = 48;
/** Failed checks in a row after which the switch turns itself off. */
export const MAX_FAILED_IN_A_ROW = 3;
/** Nothing runs this soon after the app starts. */
export const QUIET_AFTER_START_MS = 60_000;
/** Model turns a check has to answer. */
export const MAX_CHECK_TURNS = 4;
/** How often the schedule looks at the clock. */
export const TICK_MS = 30_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day, such as "2026-11-19". */
export function dayOf(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The message a check sends. It is built here from a fixed sentence and the
 * person's own words, and saved in the chat marked as a check, so it is never
 * mistaken for something the person typed.
 */
export function checkMessage(lookFor: string, now: Date): string {
  const look = cleanLookFor(lookFor);
  return [
    "This is a scheduled check. The app started it on its own; the person did not type it.",
    `It is ${dayOf(now)} ${pad(now.getHours())}:${pad(now.getMinutes())} on the person's computer.`,
    "Only look: read what you are allowed to read. Do not try to change, save, send or ask for anything. Anything that would need the person's Approve is not asked during a check, so if you find something like that, say in your update that it is waiting for them.",
    "Reply with a short update for the person. If nothing needs them, say so in one line.",
    `What the person asked you to look for, in their own words:\n${look}`,
  ].join("\n\n");
}

/** What a notice says: the assistant's name only, never text from the update. */
export function updateNotice(name: string): string {
  return `${name
    .replace(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, 60)} has an update`;
}

/** The line saved in the chat when three checks in a row failed. */
export const GAVE_UP_LINE =
  "Three checks in a row did not work, so checking on its own is off now. Look at Models, then turn it on again in Settings, under Main assistant.";

export type CheckOutcome =
  | "ran"
  | "off"
  | "quiet"
  | "not-due"
  | "busy"
  | "limit"
  | "no-text";

export interface CheckerDeps {
  now(): Date;
  /** When the app started. */
  startedAt: Date;
  settings(): CheckSettings;
  /** True while the main assistant is answering or any card waits. */
  busy(): boolean;
  load(): CheckCounters;
  save(counters: CheckCounters): void;
  /**
   * Runs one check and saves its update. Resolves when it is done, "stopped"
   * when the person stopped it, and throws when it failed.
   */
  run(): Promise<"done" | "stopped">;
  /** Switches checking off and says why in the chat. */
  giveUp(): void;
}

export class CheckScheduler {
  private flying = false;

  constructor(private readonly deps: CheckerDeps) {}

  /** True while a check is running. */
  get running(): boolean {
    return this.flying;
  }

  private counters(now: Date): CheckCounters {
    const stored = this.deps.load();
    // A new day starts the count again.
    return stored.day === dayOf(now)
      ? stored
      : { ...stored, day: dayOf(now), count: 0 };
  }

  /** A look at the clock. Starts a check only when every rule allows one. */
  async tick(): Promise<CheckOutcome> {
    const settings = this.deps.settings();
    if (!settings.on || !settings.mainAssistantId) return "off";
    const now = this.deps.now();
    if (now.getTime() - this.deps.startedAt.getTime() < QUIET_AFTER_START_MS)
      return "quiet";
    if (!settings.lookFor) return "no-text";
    const counters = this.counters(now);
    const last = counters.lastAt ? Date.parse(counters.lastAt) : Number.NaN;
    // A slot missed while the computer slept runs once, not once for each.
    const due =
      Number.isNaN(last) || now.getTime() - last >= settings.every * 60_000;
    if (!due) return "not-due";
    if (this.flying || this.deps.busy()) return "busy";
    if (counters.count >= MAX_CHECKS_A_DAY) return "limit";
    await this.go(counters, now);
    return "ran";
  }

  /**
   * The person's own click. It works with the switch off, and still only
   * reads. Throws a plain sentence when a check cannot start. Resolves once
   * the check has started, not when it ends.
   */
  async start(): Promise<void> {
    const settings = this.deps.settings();
    if (!settings.mainAssistantId)
      throw new Error("Pick the main assistant first.");
    if (!settings.lookFor) throw new Error("Say what to look for first.");
    if (this.flying) throw new Error("A check is already running.");
    if (this.deps.busy())
      throw new Error("It is busy right now. Try again when it has finished.");
    const now = this.deps.now();
    const counters = this.counters(now);
    if (counters.count >= MAX_CHECKS_A_DAY)
      throw new Error(
        `${MAX_CHECKS_A_DAY} checks have run today. Try again tomorrow.`,
      );
    void this.go(counters, now);
  }

  private async go(before: CheckCounters, now: Date): Promise<void> {
    this.flying = true;
    // Counted before it runs, so a crash in the middle never gives an extra one.
    let counters: CheckCounters = {
      ...before,
      day: dayOf(now),
      count: before.count + 1,
      lastAt: now.toISOString(),
    };
    this.deps.save(counters);
    try {
      const result = await this.deps.run();
      if (result === "done") counters = { ...counters, failures: 0 };
    } catch {
      counters = { ...counters, failures: counters.failures + 1 };
      if (counters.failures >= MAX_FAILED_IN_A_ROW) {
        counters = { ...counters, failures: 0 };
        this.deps.giveUp();
      }
    } finally {
      this.flying = false;
      this.deps.save(counters);
    }
  }
}

/**
 * Looks at the clock every half minute. Never blocks the window, and never
 * keeps the app from quitting.
 */
export function scheduleChecks(scheduler: CheckScheduler): void {
  setInterval(
    () => void scheduler.tick().catch(() => undefined),
    TICK_MS,
  ).unref();
}
