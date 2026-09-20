/**
 * Spaces sends to ONE provider at that provider's own rate.
 *
 * ── WHY THE QUEUE'S LIMITER IS NOT ENOUGH ────────────────────────────
 * BullMQ gives the email worker a single Redis-backed limiter, and one
 * number cannot express two providers. It was pinned at Resend's 2/s,
 * so adding SES at 14/s and leaving it there would drain a busy day at
 * a quarter speed; raising it to 14 and leaving it there would remove
 * Resend's protection entirely — and a failover storm, which is exactly
 * when everything piles onto Resend at once, would blow its cap, earn
 * 429s, and mark real password-reset mail FAILED. That is the "poison
 * the provider you are holding in reserve" failure, arriving through
 * the back door.
 *
 * So the worker's limiter becomes the ceiling of the FASTEST live
 * provider — the queue stops being the bottleneck — and this paces each
 * provider to its own rate underneath it.
 *
 * ── WHY IN-PROCESS IS EXACT TODAY, AND WHERE THAT STOPS ──────────────
 * SCALE-1: exactly ONE API process owns the background queues, gated by
 * `WORKERS_ENABLED`; every other instance serves HTTP only. There is
 * therefore exactly one email worker, so an in-process pacer is precise
 * rather than approximate. If that ever changes — a second worker
 * process, or apps/workers deployed alongside a queue-owning API —
 * this becomes per-process and each instance would pace to the full
 * rate on its own. The fix at that point is a Redis counter keyed on
 * the provider name, not a bigger number here.
 */
export class ProviderPacer {
  /** Earliest epoch-ms at which the next send to this provider may go. */
  private readonly nextAt = new Map<string, number>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /**
   * Waits until this provider may be called again, then claims that
   * slot. Returns how long it waited, which is what a test asserts on
   * and what the router logs when it is material.
   *
   * The slot is claimed BEFORE the wait, so concurrent callers queue
   * behind each other deterministically instead of all reading the same
   * "next free" moment and going at once — the same read-then-write
   * mistake that makes an unlocked balance wrong.
   */
  async take(provider: string, maxPerSecond: number): Promise<number> {
    if (maxPerSecond <= 0) return 0;
    const minGapMs = 1000 / maxPerSecond;
    const now = this.now();
    const earliest = this.nextAt.get(provider) ?? 0;
    const goAt = Math.max(now, earliest);
    this.nextAt.set(provider, goAt + minGapMs);
    const waitMs = goAt - now;
    if (waitMs > 0) await this.sleep(waitMs);
    return waitMs;
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
