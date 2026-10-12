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

An untested replacement is the same failure in new clothes. Do all four.

```bash
# a) It can see a healthy system, and sends nothing.
curl -s "https://skydrop-tracking-watchdog.<your-subdomain>.workers.dev/?dry=1"
#    expect: {"level":0,"summary":"tracking is moving",...}

# b) It can send. Point it at a URL that is always 503, deploy, wait two
#    ticks, confirm the ALERT arrives with the runbook in it.
#    In wrangler.toml:  HEALTH_URL = "https://httpstat.us/503"
npx wrangler deploy
#    …then put HEALTH_URL back and redeploy. Expect a RECOVERED email.

# c) UptimeRobot can send: use its "Test notification", or point the
#    monitor at the same 503 URL briefly.
```

**d)** Leave all three running in parallel for at least one full day.
Only then delete `.github/workflows/tracking-watchdog.yml` — coverage
must never have a gap in the middle.

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
