# Cloudflare — inbound courier email

The API side is built and deployed with everything else. This is the half
that lives in Cloudflare and has to be provisioned by hand, once.

**Nothing here is live yet.** Until steps 1–5 are done, the endpoint
exists and rejects everything (it fails closed on a missing secret).

---

## What this is for

Delhivery CCs a mailbox on ticket activity. Their notification emails do
not accept replies, so the mailbox is a READ channel only — it is how
courier replies reach the Skydrop thread without a human relaying them.

Cloudflare Email Routing is used because Cloudflare is already the DNS
authority for the domain: no new vendor, no mailbox to poll, no IMAP
credential to store. Email Routing can only *forward* or *run a Worker*,
and forwarding to a person is the thing being replaced — hence the
Worker.

---

## 1. The mailbox

Cloudflare dashboard → the `skydrop.online` zone → **Email** → **Email
Routing**.

- Enable Email Routing if it is not already on. It will add MX and TXT
  records; let it.
- Create the destination address. Suggested: **`courier@skydrop.online`**.

Use a dedicated address, not a shared ops inbox. Everything arriving here
is parsed and stored automatically, and pointing it at an address humans
also use means personal mail ends up in `courier_escalation_messages`.

## 2. The secret

Generate one and put the SAME value in both places:

```bash
openssl rand -hex 32
```

- **API** — add to the droplet's `.env` as `COURIER_INBOUND_EMAIL_SECRET`,
  then `pm2 restart skydrop-api`.
- **Worker** — `wrangler secret put SKYDROP_INBOUND_SECRET` (step 3).

If they disagree, every message 401s. That is the intended failure: a
mismatch must not be something the endpoint shrugs off.

## 3. Deploy the Worker

From `infra/cloudflare/`:

```bash
npx wrangler deploy courier-inbound-email-worker.js \
  --name skydrop-courier-inbound-email \
  --compatibility-date 2026-08-01

npx wrangler secret put SKYDROP_INBOUND_SECRET \
  --name skydrop-courier-inbound-email
# paste the value from step 2

npx wrangler deploy courier-inbound-email-worker.js \
  --name skydrop-courier-inbound-email \
  --var SKYDROP_API_URL:https://api.skydrop.online/public/courier/inbound-email
```

The script is versioned in this repo on purpose. Edit it here, deploy
from here — a Worker that only exists in the dashboard has no history and
no review.

## 4. Route the mailbox at the Worker

Email Routing → **Routes** → add a rule:

- **Custom address**: `courier@skydrop.online`
- **Action**: *Send to a Worker*
- **Worker**: `skydrop-courier-inbound-email`

## 5. Tell Delhivery to CC it

Ask the SPOC to add `courier@skydrop.online` as a CC on ticket
notifications. Until they do, the pipeline is complete and receives
nothing.

---

## Verifying it works

Send a plain email to `courier@skydrop.online` with a subject like
`Ticket ID: 1234567 test`, then:

```bash
# The Worker ran and what it said
npx wrangler tail --name skydrop-courier-inbound-email

# The API's side
ssh skydrop 'pm2 logs skydrop-api --lines 200 --nostream | grep -i inbound-email'
```

Expected results, in order of how much they tell you:

| Outcome | Meaning |
|---|---|
| `NO_TICKET_ID` | Signature verified, parse failed. The parser's guesses need correcting against a real Delhivery email — see the `TODO(delhivery-api)` in `courier-email-parser.ts`. |
| `NO_ESCALATION` | Parsed fine; we have no escalation with that ticket id. Correct for a test id. |
| `STORED` | End to end. |
| `401` | The secrets disagree, or `COURIER_INBOUND_EMAIL_SECRET` is unset. |

**`NO_TICKET_ID` on the first real Delhivery email is the expected
result, not a failure.** The subject wording and ticket-id format are
unverified; the first genuine message is what corrects them.

---

## What is deliberately NOT here

- **Outbound email.** Delhivery's notifications do not accept replies, so
  there is nothing to send. Replies go via the portal (Phase 5) or a
  human.
- **Attachment handling.** Damage and fake-remark cases need photos, but
  storage, scanning and the Spaces path are Phase 3 work. The Worker
  currently forwards the message body only.
