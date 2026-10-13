/**
 * The tracking watchdog — the layer that does not share fate with the app.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────
 * Delhivery pushes us no webhooks, so `TrackingPollService` is the only
 * thing moving an order through IN_TRANSIT, OUT_FOR_DELIVERY and
 * DELIVERED. If it stops, NOTHING BREAKS LOUDLY: the site stays up, no
 * request fails, and the first person to notice is a seller asking why a
 * parcel has not moved since Tuesday. Orders never reach DELIVERED, so
 * COD is never credited and payouts stop with it.
 *
 * The app alarms on itself when a cycle RUNS and fails. Nothing inside
 * the app can report a cycle that NEVER STARTED, or an app that is not
 * running at all. That is the whole job of this worker, and it is why it
 * must live somewhere the app cannot take down with it.
 *
 * ── WHY IT REPLACED A GITHUB ACTIONS CRON ────────────────────────────
 * The same check ran as a scheduled workflow. Two reasons it moved:
 *
 *   1. GitHub disables scheduled workflows after 60 days of repository
 *      inactivity. A dead-man's switch that can quietly switch ITSELF
 *      off is the failure it exists to prevent. Cron Triggers have no
 *      such rule.
 *   2. It billed a full minute per run for six seconds of work — 1,440
 *      minutes a month, which was most of a private repo's allowance.
 *
 * ── WHY IT READS THE BODY AND NOT JUST THE STATUS ────────────────────
 * `/health/tracking` answers 503 only once the poller has been silent
 * for `staleAfterMinutes` (45). A plain up/down monitor can therefore
 * only ever tell us after the fact. The body carries
 * `minutesSinceLastRun`, so this can say "one cycle has been missed"
 * BEFORE the parcel flow is officially stale. An uptime monitor watches
 * the same URL as a second, independent backstop; this one is the
 * instrument.
 *
 * ── WHY TWO CONSECUTIVE TICKS ────────────────────────────────────────
 * One failed request is a network blip, and paging a human for one is
 * how alerts come to be ignored. Two ticks at 15 minutes means a real
 * outage is in a mailbox within 15–30 minutes of the endpoint turning —
 * still twice as fast as the 30-minute cron it replaced.
 *
 * NOTE ON THE SLEEP THAT ISN'T HERE: the Actions version retried once
 * after sleeping 60 seconds in the same run. A scheduled Worker should
 * not hold an invocation open for a minute, so the retry is expressed as
 * state across ticks instead. Same guarantee, no sleep.
 */

export interface Env {
  /** KV namespace holding the tiny state machine below. */
  WATCHDOG_STATE: KVNamespace;
  /** Secret. Resend API key — the only outbound channel this has. */
  RESEND_API_KEY: string;
  /** Secret. Where the alert lands. Comma-separated for more than one. */
  ALERT_TO: string;
  /** The endpoint to ask. */
  HEALTH_URL: string;
  /** Any address on the Resend-verified domain. */
  ALERT_FROM: string;
  ALERT_REPLY_TO: string;
  /**
   * Minutes since the last cycle at which to warn EARLY, before the API
   * itself flips to 503 at 45. Set empty to disable the early warning
   * and alert only on a real 503.
   */
  WARN_MINUTES: string;
}

/** 0 healthy · 1 one cycle missed · 2 stale or unreachable. */
type Level = 0 | 1 | 2;

interface State {
  /** Consecutive ticks at level >= 1. Reset by a healthy tick. */
  consecutive: number;
  /** The worst level we have already emailed about this episode. */
  notified: Level;
}

const STATE_KEY = 'tracking';
const FRESH: State = { consecutive: 0, notified: 0 };

/** How many bad ticks before a human hears about it. */
const TICKS_BEFORE_ALERT = 2;

interface Probe {
  level: Level;
  /** One line for the subject. */
  summary: string;
  /** What we actually saw, for the body. */
  detail: string;
}

/**
 * The runbook, lifted from the workflow this replaced.
 *
 * It is in the ALERT rather than in a wiki because the moment it is
 * needed is 3am on a phone, and a link is one more thing to fail.
 */
const RUNBOOK = `Check, in order:

  1. Is the API up at all?
       curl -s https://api.skydrop.global/health/live
  2. Is the worker running?
       pm2 list on the droplet. WORKERS_ENABLED must not be false.
  3. Did Redis lose the repeatable job?
       Restarting the API re-adds it on boot.
  4. Is courier.delhivery_api_base_url still set?
       Empty means stub mode — the poller returns immediately and does nothing.
  5. Recent audit_logs:
       tracking.poll_all_batches_failed    (credential, or their API)
       tracking.poll_stub_mode_with_inflight (setting cleared)

To recover without waiting for the next cycle:
       POST /admin/tracking/poll/run
It is safe to press repeatedly — only scans newer than each parcel
already has are applied.`;

const WHAT_IT_MEANS = `What this means: no parcel is updating. Orders will not reach
DELIVERED, so COD is not being credited and payouts have stopped with it.
Nothing else will look broken — the site stays up and no request fails.`;

async function probe(env: Env): Promise<Probe> {
  const warnAt = Number.parseInt(env.WARN_MINUTES ?? '', 10);

  let res: Response;
  try {
    res = await fetch(env.HEALTH_URL, {
      // A watchdog that waits forever reports nothing. 15s is far longer
      // than this endpoint's real cost (one indexed read).
      signal: AbortSignal.timeout(15_000),
      headers: { accept: 'application/json' },
      cf: { cacheTtl: 0, cacheEverything: false },
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      level: 2,
      summary: 'the API could not be reached',
      detail: `GET ${env.HEALTH_URL}\nThe request itself failed: ${why}`,
    };
  }

  // The body is best-effort: a 503 is already conclusive, and a proxy
  // error page is not JSON. Never let parsing decide the verdict.
  let body: { status?: string; minutesSinceLastRun?: number | null; staleAfterMinutes?: number } =
    {};
  let raw = '';
  try {
    raw = await res.text();
    body = JSON.parse(raw) as typeof body;
  } catch {
    /* keep raw for the email */
  }

  const mins = typeof body.minutesSinceLastRun === 'number' ? body.minutesSinceLastRun : null;
  const staleAfter = typeof body.staleAfterMinutes === 'number' ? body.staleAfterMinutes : null;
  const seen =
    `GET ${env.HEALTH_URL}\n` +
    `HTTP ${res.status}\n` +
    (mins === null ? `body: ${raw.slice(0, 400)}` : `last cycle completed ${mins} minutes ago`) +
    (staleAfter === null ? '' : ` (counted stale after ${staleAfter})`);

  if (res.status !== 200 || body.status === 'stale') {
    return { level: 2, summary: 'tracking has stopped moving', detail: seen };
  }

  // Healthy, but creeping. Only when an explicit threshold is configured
  // — an early warning nobody asked for is the kind of mail people learn
  // to filter.
  if (Number.isFinite(warnAt) && warnAt > 0 && mins !== null && mins >= warnAt) {
    return {
      level: 1,
      summary: `a tracking cycle has been missed (${mins}m)`,
      detail: `${seen}\n\nThis is a WARNING, not an outage: the API still answers 200. It becomes an outage at ${staleAfter ?? 45} minutes.`,
    };
  }

  return { level: 0, summary: 'tracking is moving', detail: seen };
}

async function email(env: Env, subject: string, text: string): Promise<void> {
  const to = env.ALERT_TO.split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (to.length === 0) return;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.ALERT_FROM,
      to,
      reply_to: env.ALERT_REPLY_TO,
      subject,
      text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // Throwing is deliberate: a failed send marks the invocation as
    // errored in the Cloudflare dashboard, which is the only place left
    // that can tell us the watchdog itself is broken. Swallowing it
    // would make a mute watchdog look healthy.
    throw new Error(`Resend refused the alert: HTTP ${res.status} ${await res.text()}`);
  }
}

async function readState(env: Env): Promise<State> {
  const raw = await env.WATCHDOG_STATE.get(STATE_KEY, 'json');
  if (raw === null || typeof raw !== 'object') return { ...FRESH };
  const s = raw as Partial<State>;
  return {
    consecutive: typeof s.consecutive === 'number' ? s.consecutive : 0,
    notified: s.notified === 1 || s.notified === 2 ? s.notified : 0,
  };
}

export async function tick(env: Env): Promise<void> {
  const p = await probe(env);
  const before = await readState(env);
  const after: State = { ...before };

  if (p.level === 0) {
    after.consecutive = 0;
    after.notified = 0;
    if (before.notified > 0) {
      await email(
        env,
        '[Skydrop] RECOVERED — tracking is moving again',
        `Tracking is answering normally again.\n\n${p.detail}\n\n` +
          `No action needed. This closes the alert sent earlier.`,
      );
    }
  } else {
    after.consecutive = before.consecutive + 1;
    // Escalation, not repetition: a second email only goes out if things
    // got WORSE than what was already reported.
    if (after.consecutive >= TICKS_BEFORE_ALERT && p.level > before.notified) {
      after.notified = p.level;
      const isOutage = p.level === 2;
      await email(
        env,
        isOutage
          ? '[Skydrop] TRACKING HAS STOPPED — COD credits are not running'
          : `[Skydrop] Warning — ${p.summary}`,
        `${p.detail}\n\n` +
          `Seen on ${after.consecutive} consecutive checks, so this is not a blip.\n\n` +
          (isOutage ? `${WHAT_IT_MEANS}\n\n${RUNBOOK}\n` : `${RUNBOOK}\n`),
      );
    }
  }

  if (after.consecutive !== before.consecutive || after.notified !== before.notified) {
    await env.WATCHDOG_STATE.put(STATE_KEY, JSON.stringify(after));
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    // AWAITED, not `ctx.waitUntil`, and the difference is the whole
    // reason the Cloudflare "Script errors" notification can be trusted.
    //
    // `email()` throws on purpose when Resend refuses, because an
    // invocation marked errored in the dashboard is the only thing left
    // that can report that this watchdog has gone mute. Handing the
    // promise to `waitUntil` and returning makes the handler resolve
    // before the work finishes, so the invocation's own outcome no
    // longer depends on it — which would leave a watchdog that cannot
    // send mail looking perfectly healthy. A cron handler has nothing
    // waiting on it, so there is nothing to gain by returning early.
    await tick(env);
  },

  /**
   * A manual trigger, so the watchdog can be PROVEN to work without
   * waiting for a cron or breaking production to see it fire.
   *
   * `?dry=1` reports what it saw and sends nothing. Unauthenticated on
   * purpose: it reveals only what the public health endpoint already
   * does, and requiring a secret here would mean one more credential for
   * the one tool you reach for when things are already wrong.
   */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.searchParams.get('dry') === '1') {
      const p = await probe(env);
      const s = await readState(env);
      return Response.json({ level: p.level, summary: p.summary, detail: p.detail, state: s });
    }
    await tick(env);
    return Response.json({ ok: true, ran: new Date().toISOString() });
  },
};
