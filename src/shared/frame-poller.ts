/**
 * The live pictures of the assistants' computers, for every place on the
 * page that shows one (the thumbnail in the chat's head and the panel beside
 * the chat). One loop for each computer, however many places watch it, so
 * Docker is asked for one picture about once a second, never more.
 *
 * It asks only while all three hold: something on the page watches that
 * computer, the computer is on, and the window is visible. No DOM here: the
 * page hands in the clock, the timers and whether the window is visible.
 */

/** About once a second. */
export const FRAME_EVERY = 1000;

export interface PollState {
  /** How many places on the page show this computer now. */
  watchers: number;
  on: boolean;
  visible: boolean;
}

/** Whether a computer's picture is asked for at all. */
export function shouldPoll(state: PollState): boolean {
  return state.watchers > 0 && state.on && state.visible;
}

export interface FramePollerDeps<T> {
  /** One picture of that computer's screen; null when it has none. */
  fetch(assistantId: string): Promise<T | null>;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

interface Entry<T> {
  listeners: Set<(frame: T | null) => void>;
  on: boolean;
  latest: T | null;
  timer: unknown;
  /** True while a picture is being fetched: the next waits for it. */
  fetching: boolean;
}

export class FramePoller<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private visible = true;

  constructor(private readonly deps: FramePollerDeps<T>) {}

  private entry(assistantId: string): Entry<T> {
    let found = this.entries.get(assistantId);
    if (!found) {
      found = {
        listeners: new Set(),
        on: false,
        latest: null,
        timer: undefined,
        fetching: false,
      };
      this.entries.set(assistantId, found);
    }
    return found;
  }

  /** The newest picture of that computer, or null. */
  latest(assistantId: string): T | null {
    return this.entries.get(assistantId)?.latest ?? null;
  }

  /** Starts showing a computer; the returned function stops. */
  watch(assistantId: string, listener: (frame: T | null) => void): () => void {
    const entry = this.entry(assistantId);
    entry.listeners.add(listener);
    this.update(assistantId);
    return () => {
      entry.listeners.delete(listener);
      this.update(assistantId);
    };
  }

  /** The computer went on or off. Off forgets its picture. */
  setOn(assistantId: string, on: boolean): void {
    const entry = this.entry(assistantId);
    if (entry.on === on) return;
    entry.on = on;
    if (!on && entry.latest !== null) {
      entry.latest = null;
      for (const listener of entry.listeners) listener(null);
    }
    this.update(assistantId);
  }

  /** The window became visible or hidden. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const id of this.entries.keys()) this.update(id);
  }

  private polling(entry: Entry<T>): boolean {
    return shouldPoll({
      watchers: entry.listeners.size,
      on: entry.on,
      visible: this.visible,
    });
  }

  private update(assistantId: string): void {
    const entry = this.entry(assistantId);
    if (!this.polling(entry)) {
      if (entry.timer !== undefined) this.deps.clearTimer(entry.timer);
      entry.timer = undefined;
      return;
    }
    // Already asking, or waiting for the next turn: one loop only.
    if (entry.timer !== undefined || entry.fetching) return;
    void this.take(assistantId);
  }

  private async take(assistantId: string): Promise<void> {
    const entry = this.entry(assistantId);
    entry.timer = undefined;
    if (!this.polling(entry)) return;
    entry.fetching = true;
    let frame: T | null = null;
    try {
      frame = await this.deps.fetch(assistantId);
    } catch {
      // The next one may work.
    }
    entry.fetching = false;
    if (frame !== null && entry.on) {
      entry.latest = frame;
      for (const listener of entry.listeners) listener(frame);
    }
    if (this.polling(entry) && entry.timer === undefined)
      entry.timer = this.deps.setTimer(
        () => void this.take(assistantId),
        FRAME_EVERY,
      );
  }
}
