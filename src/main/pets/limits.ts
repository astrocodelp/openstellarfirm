/**
 * A sliding window counter in memory. Desk pets are one person's own pets on
 * one home network, so a counter that starts over when the app restarts is
 * enough; nothing here is kept on disk.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly now: () => number) {}

  /** Counts one hit for `key`; false when it is over `limit` in the window. */
  take(key: string, limit: number, windowMs = 60_000): boolean {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(key, recent);
    if (this.hits.size > 2000) this.prune(at, windowMs);
    return true;
  }

  private prune(at: number, windowMs: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => at - t >= windowMs)) this.hits.delete(key);
    }
  }
}
