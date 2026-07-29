# Turning email on

**Status:** not yet live. `RESEND_API_KEY` is empty everywhere, which means
the system is in the NOTIF-6 dev stub: it renders every email, writes the
`notification_logs` row, logs `[DEV] Would send email`, and sends nothing.

Nothing needs building. This is the configuration, plus the things worth
knowing before the first real message goes out.

---

## Why not self-host on the droplet

Asked and answered, recorded here so it does not get re-litigated:

- **DigitalOcean blocks outbound port 25 by default.** Without it a droplet
  cannot deliver directly to recipient mail servers. Unblocking is a support
  ticket that DO often declines for accounts with no sending history.
- **A fresh droplet IP has no reputation**, and DO ranges frequently carry
  someone else's. The recipients here are Indian consumers, overwhelmingly on
  Gmail, which will spam-folder or reject an unknown sender.
- **What these emails are** makes that expensive. A dispatch notification in
  the spam folder is a customer who does not know their COD parcel is coming
  — which is a failed delivery and an RTO, not an annoyance.

Running an MTA properly means SPF, DKIM, DMARC, PTR, TLS, bounce and
complaint handling, suppression lists and IP warmup. It is a job, not a
config file. The code seam exists if this changes: `ResendService` is
injected in exactly one place (`EmailDispatchService`), behind a
provider-agnostic `SendEmailInput → SendEmailResult | SendEmailFailure`
interface, so a different transport is a contained change.

---

## Setup

### 1. Verify the domain in Resend

The sender addresses are fixed in `apps/api/src/modules/email/sender-resolver.ts`:

| Address | Used for |
|---|---|
| `security@skydrop.online` | password reset, email verification, login + security alerts |
| `hello@skydrop.online` | everything else — invitations, order and shipment mail |
| `support@skydrop.online` | the `reply-to` on every message |

All three are on `skydrop.online`, so that is the domain to verify — one
verification covers all of them.

In the Resend dashboard: **Domains → Add Domain → `skydrop.online`**, then
publish the DNS records it gives you at Cloudflare. There will be an SPF
`TXT`, DKIM `CNAME`s, and optionally a DMARC `TXT`.

Two Cloudflare-specific notes:

- Set the DKIM records to **DNS only** (grey cloud). Proxying them breaks
  verification.
- If a `TXT` SPF record already exists for the root, **merge** rather than
  add a second one — two SPF records is itself an SPF failure.

Until the domain verifies, every send returns a 403 and lands as a `FAILED`
row in `notification_logs`.

### 2. Set the key on the droplet

The file is **`/home/skydrop/app/.env`** — the repo-root one. There is no
`apps/api/.env` on the droplet; creating one would be read by nothing.

```
ssh skydrop
nano /home/skydrop/app/.env      # set RESEND_API_KEY=re_...
```

Then reload through the **ecosystem file**, not by restarting the process:

```
cd /home/skydrop/app
pm2 reload ecosystem.config.cjs --update-env
pm2 save
```

**`pm2 restart skydrop-api --update-env` does NOT work here** — verified by
experiment on 2026-07-29, not assumed. `--update-env` re-reads the *shell's*
environment; it does not re-parse `ecosystem.config.cjs`, and that file is
what reads `.env` (at parse time, with `fs.readFileSync`). A restart
therefore keeps the old empty value and leaves the app in stub mode while
looking configured — which is the exact failure this section exists to
prevent.

`pm2 save` afterwards matters too: without it a reboot resurrects from
`~/.pm2/dump.pm2`, which still holds the pre-change environment.

One quirk worth knowing for the rollback below: `pm2 reload` MERGES
environments rather than replacing them, so *deleting* a line from `.env`
does not remove the variable from the running process. Setting it to empty
does work. To truly remove one, `pm2 delete skydrop-api && pm2 start
ecosystem.config.cjs --only skydrop-api`.

### 3. Confirm it actually switched

On boot the API logs a warning **only in stub mode**:

```
RESEND_API_KEY is empty — emails will be logged to stdout instead of sent.
```

Absence of that line is the signal it is live. The worker's own line should
read:

```
Email worker ready (queue=email, concurrency=5, max=2/s)
```

### 4. Send one on purpose

Trigger a password reset for an address you control. Then check both ends:

- the mail arrives, and is not in spam;
- `notification_logs` has a row with `status='SENT'`, `provider='resend'`
  and a non-null `provider_message_id`.

A row with `status='FAILED'` carries `failure_code` and `failure_message`
verbatim from Resend, which is usually specific enough to act on
("domain not verified", "invalid from address").

### Rolling back

Set `RESEND_API_KEY=` to empty (do not delete the line — see the merge
quirk above) and `pm2 reload ecosystem.config.cjs --update-env`. The system
returns
to the dev stub — every notification is still rendered and still recorded,
just not delivered. Nothing else changes.

---

## Volume

A single order that reaches DELIVERED sends **seven** emails:

| Status | Seller | Customer |
|---|---|---|
| CONFIRMED | ✓ | ✓ |
| DISPATCHED | ✓ | ✓ |
| OUT_FOR_DELIVERY | | ✓ |
| DELIVERED | ✓ | ✓ |

Plus auth and onboarding mail (invitations, verification, password resets),
and the exception paths — DELIVERY_FAILED and RTO_INITIATED each notify
both parties.

Against Resend's free tier (**100/day, 3,000/month**) that is roughly
**14 fully-delivered orders a day**, or about **420 a month**. Fine for an
invite-only beta; the ceiling arrives sooner than the monthly number
suggests, because the daily cap binds first on a busy day.

The paid tier is $20/month for 50,000, which is the point at which this
stops being something to think about.

---

## Known behaviours

Neither is a bug to fix before launch; both are worth recognising when
reading the logs.

**A retried send creates extra `notification_logs` rows for pre-M11
callers.** BullMQ retries five times. The M11 lifecycle path pre-creates its
row and UPDATEs it (NOTIF-2 store-then-send), so it stays one row. The older
fire-once callers — auth, seller management, inventory, category proposals —
do not pass `existingNotificationLogId`, so each attempt CREATEs. One
persistently failing invitation email can therefore leave five `FAILED`
rows, and one that succeeds on the third attempt leaves two `FAILED` plus
one `SENT`. The emails themselves are correct; only the audit trail is
noisy. Fixing it means touching the dual idempotency regime on
`notification_logs`, which `CLAUDE.md` warns against doing casually.

**The rate limiter is set to the provider's cap, not below it.** 2/second,
Redis-backed so it holds across every API instance. If the Resend plan
changes, raise `EMAIL_MAX_PER_SECOND` in
`apps/api/src/modules/email/queue/email.worker.ts` — it is the throttle, not
the concurrency, that governs provider load.

---

## What has never been exercised

The real Resend path has never run: the key has been empty since M1, so
every test and every environment has taken the stub branch. The code is
straightforward and `replyTo` is verified correct against the installed SDK
(resend@4.8.0 — earlier majors used `reply_to`), but "reviewed" is not
"ran". Treat the first real send as a test, which is what step 4 above is
for.
