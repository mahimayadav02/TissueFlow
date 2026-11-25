// Counts attempts per key (for example phone number or IP address) inside a time window.
// Kept in memory: fine for one server. Counts reset when the server restarts.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private max: number, private windowMs: number) {}

  /** Seconds to wait if the key is over the limit, otherwise 0. Does not add a hit. */
  retryAfter(key: string, now = Date.now()): number {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) return 0;
    return h.count >= this.max ? Math.ceil((h.resetAt - now) / 1000) : 0;
  }

  hit(key: string, now = Date.now()): void {
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count++;
    if (this.hits.size > 10_000) this.sweep(now);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
  }
}
