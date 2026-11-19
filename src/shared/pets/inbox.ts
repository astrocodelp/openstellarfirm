import { PET_LIMITS } from "./limits";

/** The only part of a notice these helpers look at. */
interface Sequenced {
  readonly seq: number;
}

/** `?after=`: a non-negative whole number, else 0 (everything). */
export function parseAfter(param: string | null | undefined): number {
  if (param === null || param === undefined || !/^\d{1,15}$/.test(param)) {
    return 0;
  }
  return Number(param);
}

/**
 * `?wait=`: seconds to hold the request open, 0 to 20. A missing or unreadable
 * value waits the full 20 seconds, which is what an idle pet asks for.
 */
export function parseWait(param: string | null | undefined): number {
  const max = PET_LIMITS.inboxWaitMaxSeconds;
  if (param === null || param === undefined || param.trim() === "") {
    return max;
  }
  const seconds = Number(param);
  if (!Number.isFinite(seconds)) {
    return max;
  }
  return Math.min(max, Math.max(0, Math.floor(seconds)));
}

/**
 * The `next` of an inbox answer: the highest `seq` returned, else `after`. A
 * pet whose number is ahead of a counter that started over is told so by the
 * server (`PetInbox.read`), which answers the counter's own top instead.
 */
export function nextSeq(notices: readonly Sequenced[], after: number): number {
  let next = 0;
  for (const notice of notices) {
    if (notice.seq > next) {
      next = notice.seq;
    }
  }
  return notices.length > 0 ? next : after;
}
