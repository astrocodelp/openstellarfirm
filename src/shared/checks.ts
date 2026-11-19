/**
 * The main assistant's checks: the choices the person makes in Settings.
 * Pure, so the main process and the page read them the same way.
 */

/** How often a check may run, in minutes. */
export const CHECK_EVERY = [15, 30, 60, 180] as const;
export type CheckEvery = (typeof CHECK_EVERY)[number];
export const DEFAULT_CHECK_EVERY: CheckEvery = 60;

export const EVERY_NAMES: Record<CheckEvery, string> = {
  15: "15 minutes",
  30: "30 minutes",
  60: "Hour",
  180: "3 hours",
};

/** The most the person's own "What to look for" may hold. */
export const LOOK_FOR_MAX = 2000;

export function isCheckEvery(value: unknown): value is CheckEvery {
  return CHECK_EVERY.some((minutes) => minutes === value);
}

export function cleanCheckEvery(value: unknown): CheckEvery {
  return isCheckEvery(value) ? value : DEFAULT_CHECK_EVERY;
}

/** The person's words, with line breaks and tabs kept and other control characters taken out. */
export function cleanLookFor(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/[^\P{Cc}\n\t]+/gu, "")
        .trim()
        .slice(0, LOOK_FOR_MAX)
    : "";
}

/** The settings a check reads. Anything missing reads as its default. */
export interface CheckSettings {
  /** The one assistant that checks; none when the person has not picked it. */
  mainAssistantId?: string;
  on: boolean;
  every: CheckEvery;
  lookFor: string;
  notify: boolean;
  /** True while a check wrote an update the person has not seen. */
  unread: boolean;
}

export function checkSettings(settings: {
  mainAssistantId?: string | undefined;
  checkOnItsOwn?: boolean | undefined;
  checkEvery?: unknown;
  checkLookFor?: unknown;
  checkNotify?: boolean | undefined;
  checkUnread?: boolean | undefined;
}): CheckSettings {
  return {
    ...(settings.mainAssistantId
      ? { mainAssistantId: settings.mainAssistantId }
      : {}),
    on: settings.checkOnItsOwn === true,
    every: cleanCheckEvery(settings.checkEvery),
    lookFor: cleanLookFor(settings.checkLookFor),
    notify: settings.checkNotify === true,
    unread: settings.checkUnread === true,
  };
}
