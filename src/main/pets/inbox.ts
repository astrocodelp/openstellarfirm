import { PET_LIMITS } from "../../shared/pets/limits";
import { noticeLine } from "../../shared/pets/notice";
import type { Notice, NoticeKind } from "../../shared/pets/protocol";
import { spokenTitle } from "../../shared/pets/spoken";

/**
 * What a pet is told, one short queue for each pet, in memory. A notice is a
 * kind, the assistant's role, a cleaned work title for `done` and the chat and
 * run it is about: never step text, an amount or a digit of a number, and
 * never a way to decide anything. The queue is not saved, because a notice
 * lives a day at most and the pet asks for what it missed; the numbers start
 * from the clock, so a restart never reuses one the pet has seen.
 */

export interface NoticeInput {
  readonly kind: NoticeKind;
  readonly role?: string | null | undefined;
  /** The work's title, cleaned here; used by `done` only. */
  readonly title?: string | null | undefined;
  readonly chat?: string | undefined;
  readonly run?: string | undefined;
  /** The server's own fixed line, for a `message`. */
  readonly line?: string | undefined;
}

export interface InboxRead {
  readonly notices: readonly Notice[];
  readonly next: number;
}

interface Entry {
  readonly notice: Notice;
  readonly at: number;
}

interface Queue {
  entries: Entry[];
  waiters: Set<() => void>;
}

export class PetInbox {
  private readonly queues = new Map<string, Queue>();
  private seq: number;

  constructor(private readonly now: () => number) {
    this.seq = Math.floor(now() / 1000);
  }

  private queueOf(petId: string): Queue {
    let queue = this.queues.get(petId);
    if (!queue) {
      queue = { entries: [], waiters: new Set() };
      this.queues.set(petId, queue);
    }
    return queue;
  }

  private purge(queue: Queue): void {
    const oldest = this.now() - PET_LIMITS.inboxTtlSeconds * 1000;
    queue.entries = queue.entries
      .filter((entry) => entry.at >= oldest)
      .slice(-PET_LIMITS.inboxMaxNotices);
  }

  /** Adds a notice to one pet's queue and wakes a pet that is waiting. */
  push(petId: string, input: NoticeInput): Notice {
    const queue = this.queueOf(petId);
    this.purge(queue);
    const title =
      input.kind === "done" ? spokenTitle(input.title ?? null) : undefined;
    const line =
      input.line !== undefined
        ? input.line
        : noticeLine(input.kind, input.role, title);
    this.seq += 1;
    const notice: Notice = {
      seq: this.seq,
      kind: input.kind,
      at: new Date(this.now()).toISOString(),
      line,
      ...(title ? { title } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.chat ? { chat: input.chat } : {}),
      ...(input.run ? { run: input.run } : {}),
    };
    queue.entries.push({ notice, at: this.now() });
    this.purge(queue);
    for (const wake of [...queue.waiters]) wake();
    return notice;
  }

  /**
   * The notices after `after`. A number ahead of the newest one (the app's
   * counter is behind the pet's) is answered with the counter's own top, so
   * the pet starts over from there.
   */
  read(petId: string, after: number): InboxRead {
    const queue = this.queueOf(petId);
    this.purge(queue);
    if (after > this.seq) return { notices: [], next: this.seq };
    const notices = queue.entries
      .map((entry) => entry.notice)
      .filter((notice) => notice.seq > after);
    const next = notices.reduce((top, n) => Math.max(top, n.seq), after);
    return { notices, next };
  }

  /** Like `read`, but holds the call up to `seconds` for a first notice. */
  async wait(
    petId: string,
    after: number,
    seconds: number,
    signal: AbortSignal,
  ): Promise<InboxRead> {
    const first = this.read(petId, after);
    if (first.notices.length > 0 || seconds <= 0 || signal.aborted) {
      return first;
    }
    const queue = this.queueOf(petId);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        queue.waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, seconds * 1000);
      queue.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
    return this.read(petId, after);
  }

  /** One notice by its number, for `GET /api/pets/say/<n>`. */
  get(petId: string, seq: number): Notice | undefined {
    const queue = this.queueOf(petId);
    this.purge(queue);
    return queue.entries.find((entry) => entry.notice.seq === seq)?.notice;
  }

  forget(petId: string): void {
    const queue = this.queues.get(petId);
    if (!queue) return;
    for (const wake of [...queue.waiters]) wake();
    this.queues.delete(petId);
  }
}
