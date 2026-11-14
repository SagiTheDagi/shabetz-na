/**
 * In-memory sliding-window limit on chat requests per admin (same approach as
 * the login limiter in auth.ts: per-process, resets on restart).
 */
export const CHAT_REQUESTS_PER_MINUTE = 10;
const WINDOW_MS = 60_000;

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private limit = CHAT_REQUESTS_PER_MINUTE,
    private windowMs = WINDOW_MS,
    private now: () => number = Date.now,
  ) {}

  /** Records the hit if allowed. retryAfterMs is set when refused. */
  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterMs: this.windowMs - (t - recent[0]) };
    }
    recent.push(t);
    this.hits.set(key, recent);
    return { allowed: true };
  }
}

const g = globalThis as unknown as { __insightsRateLimiter?: RateLimiter };
export function getChatRateLimiter(): RateLimiter {
  return (g.__insightsRateLimiter ??= new RateLimiter());
}
