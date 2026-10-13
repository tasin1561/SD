# Tracking watchdog — setup

Two independent watchdogs on one endpoint. They share no infrastructure,
so neither can go quietly dead without the other still covering a real
outage — which is the failure the GitHub Actions version warned about in
its own comments and could not protect itself from.

| | what it does | why both |
|---|---|---|
| **Cloudflare Worker** | reads the body, warns EARLY, carries the runbook | the instrument |
| **UptimeRobot** | plain up/down on the same URL | the backstop, on someone else's wires |

The endpoint was built for this: `/health/tracking` is `@Public()`,
answers **200 healthy / 503 stale**, and carries no counts or customer
data. Its own comment says *"a non-2xx is the one signal every
monitoring tool already understands."*

---

## 1. Resend

Nothing to build — the domain is already verified, and Resend verifies
the **domain**, not the local part, so `alerts@skydrop.global` works
without adding an address.

1. Resend → **API Keys** → create one named `tracking-watchdog`, with
   **Sending access only**. Do NOT reuse the API's key: this one lives in
   a different system, and a key you can rotate on its own is the point.
2. Keep it for step 2. It is shown once.

Replies go to `support@skydrop.global`, matching `sender-resolver.ts`.

---

## 2. Cloudflare Worker

```bash
cd infra/tracking-watchdog
npm install                      # not pnpm: this is OUTSIDE the workspace
npx wrangler login

# State lives in KV: the consecutive-bad counter and what has already
# been reported. ~96 reads/day and almost no writes — the free tier is
# 100,000 reads and 1,000 writes a day.
npx wrangler kv namespace create WATCHDOG_STATE
# → paste the printed id into wrangler.toml, replacing REPLACE_ME

npx wrangler secret put RESEND_API_KEY     # the key from step 1
npx wrangler secret put ALERT_TO           # you@example.com (comma-separated for several)

npx wrangler deploy
```

**Settings already in `wrangler.toml`**, change only if you disagree:

| setting | value | why |
|---|---|---|
| cron | `*/15 * * * *` | two bad ticks before alerting ⇒ 15–30 min to a mailbox |
| `HEALTH_URL` | `https://api.skydrop.global/health/tracking` | |
| `WARN_MINUTES` | `35` | past one missed 20-min cycle, before the 45-min stale line. `""` disables the early warning |
| `ALERT_FROM` | `alerts@skydrop.global` | any address on the verified domain |

### Also turn on Cloudflare's own notification

The Worker is the thing watching everything else, so something must
watch *it*. A refused Resend call **throws on purpose**, which marks the
invocation errored.

Cloudflare dashboard → **Notifications** → Add → **Workers** → *Script
errors* → pick `skydrop-tracking-watchdog` → email yourself.

Without this, a mute watchdog looks identical to a healthy one.

---

## 3. UptimeRobot

Free plan. New monitor:

| field | value |
|---|---|
| Monitor type | **HTTP(s)** |
| Friendly name | `Skydrop tracking poller` |
| URL | `https://api.skydrop.global/health/tracking` |
| Interval | **5 minutes** |
| Timeout | 30s |
| Alert contacts | your email |

Then, so it does not double-page you:

- **Confirmation / retries before alerting:** set the highest the plan
  allows (2–3). The Worker is the primary and alerts first; UptimeRobot
  should speak mainly when the Worker *failed* to, which makes it the
  watchdog's watchdog at no extra cost. Your own codebase argues this —
  a bell that rings for everything is one people turn off.
- **Do not** enable keyword monitoring. A 503 is already conclusive, and
  a keyword rule is a second thing to get wrong.

Note it cannot carry the runbook. That is what the Worker's email is
for; this one only has to say *something is wrong*.

---

## 4. Prove it works, THEN delete the workflow

An untested replacement is the same failure in new clothes.

A watchdog has TWO halves and they rot differently. The check breaks
loudly — it starts answering wrong and you can see it. The ALERT breaks
silently: a rotated key, a domain that fell out of verification, a
mailbox rule, and nothing looks any different until the one night it
matters. So both are tested separately.

```bash
WD=https://skydrop-tracking-watchdog.bagscosmic.workers.dev

# a) THE CHECK. Reads the live endpoint, sends nothing.
curl -s "$WD/?dry=1"
# {"level":0,"summary":"tracking is moving",
#  "detail":"...HTTP 200\nlast cycle completed 16 minutes ago (counted stale after 45)",
#  "state":{"consecutive":0,"notified":0}}

# b) THE ALERT. Sends a clearly-marked test through the SAME code, key
#    and sender a real alert uses — so a success here means the channel
#    genuinely works, and nothing is left mis-configured afterwards.
curl -s "$WD/?selftest=1"
# {"ok":true,"sent":true,...}   → then CHECK THE INBOX, and spam.
#
# Re-run this after rotating the Resend key, changing the sender, or
# touching mail rules. Those are exactly when the alert leg dies quietly.
# 10-minute cooldown; a second call inside it answers 429.

# c) THE STATE STORE, which the "two consecutive bad ticks" rule depends
#    on. The 429 above IS this test: the cooldown needs a KV write and a
#    KV read to work. If KV were mis-bound the counter would reset every
#    tick, never reach two, and the watchdog would NEVER ALERT while
#    looking perfectly healthy.

# d) UptimeRobot can send: use its "Test notification".
```

Verified working 2026-10-13: (a) 200 with the body read, (b) accepted by
Resend, (c) 429 with `retryInSeconds`.

**e)** Leave all three running in parallel for at least one full day.
Only then delete `.github/workflows/tracking-watchdog.yml` — coverage
must never have a gap in the middle.

### The deeper end-to-end test, if you want it

The self-test proves the alert channel. It does not prove the
*decision* — that two bad ticks actually escalate. For that, point
`HEALTH_URL` at `https://httpstat.us/503`, deploy, hit `$WD/` (no query
string) twice to force two ticks, and confirm the real ALERT arrives
with the runbook. Then put `HEALTH_URL` back, deploy, hit it once more
and confirm the RECOVERED mail.

Worth doing once. Just do not leave it pointed at the fake endpoint —
which is the whole reason the self-test exists as the everyday check.

---

## What this changed

- **Cost.** The workflow billed a full minute per run for ~6 seconds of
  work: 1,440 min/month, which was most of a private repo's allowance.
  Removing it takes ~3,900 min/month to ~2,460, inside the 3,000 that
  GitHub Pro already includes.
- **Detection.** 30-minute cron → 5-minute checks, plus a warning
  *before* the endpoint goes stale at all.
- **Reliability.** GitHub disables scheduled workflows after 60 days of
  repository inactivity. Neither of these does.

## What did NOT change

The 45-minute staleness line lives in the API
(`TRACKING_STALE_AFTER_MINUTES`), not here. These tools only control how
fast the 503 is *noticed*. Moving that threshold is a different decision
in a different place.
