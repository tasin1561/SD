# Email DNS for skydrop.global

**Status (2026-10-04): NOTHING on `skydrop.global` is verified yet. This
document is the arrangement to BUILD, not a measurement.** It mirrors
exactly what was live on `skydrop.online` — Resend sends, Cloudflare Email
Routing receives, DMARC at quarantine — because that arrangement was
verified end to end on 2026-09-09 and the reasoning behind each choice is
domain-independent. What has happened so far: `skydrop.global` is added to
Resend (region `ap-northeast-1`), status `not_started` pending DNS.

Every claim about `.online` in the history section below WAS checked with
`dig`. Nothing in the tables above it has been. **Verify with `dig`, not
off a dashboard** — see "Reading it yourself", because the Cloudflare panel
gets one of these wrong.

---

## THE ORDERING HAZARD — read this before merging the rename

The From and Reply-To identities in
`apps/api/src/modules/email/sender-resolver.ts` move to `@skydrop.global`
in the same branch as this document. Resend refuses to send from an
unverified domain, so **if the code ships before the DKIM/SPF records are
in and Resend reports the domain verified, every transactional email in the
estate stops** — password resets, seller invitations, order and dispatch
notices, the CRITICAL system-issue mail. It fails at the provider, not at
our gate, so the symptom is a `notification_logs` row that never leaves
QUEUED and NOTIF-22's watchdog raising `email-undelivered` an hour later.

Order: **DNS first, Resend verified second, deploy third.** The reverse is
an outage with a one-hour detection lag.

---

## What needs to be in DNS

| Record | Name | What it is for |
|---|---|---|
| TXT | `resend._domainkey.skydrop.global` | **DKIM.** Signs our mail as `@skydrop.global`. Resend issues the exact value. |
| TXT | `send.skydrop.global` | **SPF** for the envelope sender: `v=spf1 include:amazonses.com ~all` |
| MX | `send.skydrop.global` | SES's bounce/complaint collector, so Resend learns about failures |
| A | root, `admin`, `api`, `app`, `reseller`, `track`, `www` | the droplet, 68.183.190.55, all proxied (`docs/cloudflare-proxy.md`) |
| CAA | root | Let's Encrypt only |

That is Resend's standard shape and it is the right one: the **root**
domain is the verified one (hence DKIM at the root), while `send.` is the
custom Return-Path. SPF authenticates the envelope
(`send.skydrop.global`), DKIM authenticates the visible From
(`@skydrop.global`), and DMARC passes through DKIM alignment.

Take the record values from the Resend dashboard for THIS domain. Do not
copy the `.online` values across — DKIM keys are per domain.

## Receiving — Cloudflare Email Routing

| Record | Name | Value |
|---|---|---|
| MX | root | `route1.mx.cloudflare.net` (35), `route2` (9), `route3` (62) |
| TXT | root | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf2024-1._domainkey` | Cloudflare's DKIM, for mail it FORWARDS |

Forwarding rule to create, to `chwhdev@gmail.com`:

- `support@skydrop.global` — the `Reply-To` on every message we send

**`api@` is NOT on this list, and that is deliberate.** Shiprocket mails
the API user's password to `api@skydrop.online` and that address is the
account's LOGIN, held encrypted in `courier_credentials` (CUR-1). It did
not move with the brand domain. Either keep the `api@skydrop.online`
routing rule alive on the retired zone, or change the API user in
Shiprocket's own panel FIRST and then add `api@skydrop.global` here — see
`docs/shiprocket-integration.md`. That account also handles COD
remittance, so a locked-out sign-in is expensive to discover.

**Two DKIM keys is correct, not a mistake.** DKIM is selector-scoped:
Resend signs with `resend`, Cloudflare signs forwarded mail with
`cf2024-1`, and each signature names its own selector. A domain may hold
any number. **SPF is the opposite** — two SPF records on one name is a
permerror, which is why the root must have exactly one and why nothing
should add another. If SES ever needs to send with a ROOT envelope, MERGE
the include into the existing record; never add a second.

**The test that means anything:** send a real message through Resend to
`support@skydrop.global` and confirm `last_event: delivered`. That proves
Cloudflare is accepting mail for an address with an MX behind it, and that
Resend will send as the new domain at all. Do it before the deploy, not
after.

## DMARC

It matters more here than on an ordinary domain because **this domain sends
password resets**. With no DMARC policy, anyone can forge
`From: security@skydrop.global` and no receiver has been told to reject it;
a spoofed password reset is the highest-value phish available against a
seller. Separately, Gmail and Yahoo have required DMARC from bulk senders
since February 2024, so its absence quietly costs inbox placement on the
mail we do send.

The record to publish, matching what `.online` ran:

```
_dmarc  TXT  "v=DMARC1; p=quarantine; sp=reject; rua=mailto:<id>@dmarc-reports.cloudflare.net; fo=1"
```

Cloudflare's wizard writes `p=none` first:

```
_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net"
```

`p=none` is a deliberate FIRST step and not a half-measure: it changes
nothing about delivery and just starts the reports, so every legitimate
sender can be confirmed passing BEFORE tightening. Going straight to
`p=reject` on a domain nobody has measured is how you discover a forgotten
sender by having its mail silently dropped.

### Why one report cycle is enough, not weeks

The usual advice — observe for weeks before enforcing — exists for
organisations that cannot say what sends as them. We can:

- **One sender.** `resend.service.ts` is the only file that calls a mail
  API. No SMTP, no nodemailer, no second provider. The other
  `@skydrop.global` strings in the code are Swagger examples.
- **Aligned by construction.** Resend's verified domain is the ROOT
  (`skydrop.global`), so DKIM signs `d=skydrop.global` and aligns with our
  `From` under strict alignment, never mind relaxed.
- **Verify after the change.** Send from `security@skydrop.global` — the
  address most worth forging — through the real Resend path under
  `p=quarantine` and confirm `last_event: delivered`.

### The three choices in that record

**`p=quarantine` before `p=reject`.** Quarantine is real enforcement: a
forged reset lands in spam rather than the inbox. It is preferred for the
first few days over reject because of the one thing that cannot be verified
from inside the codebase — whether a human has configured Gmail's "Send
mail as" for `hello@` or `support@skydrop.global`. That mail carries no
DKIM of ours. Under quarantine it goes to spam and is recoverable; under
reject it is destroyed and nobody is told.

**`sp=reject` immediately.** No subdomain sends mail with a `From` header,
so subdomains can be locked hard at once even while the root sits at
quarantine. It closes the easiest forgery route at zero risk.

**Alignment left RELAXED** — no `adkim=s`/`aspf=s`. Strict looks tighter
and is worse here: the envelope sender is `send.skydrop.global`, so strict
SPF alignment would fail and DKIM would become the only path to a pass. A
forwarder that alters a body would then take the mail out entirely. Relaxed
keeps SPF and DKIM as two independent ways to pass.

### THE REMAINING STEP

Move `p=quarantine` → `p=reject` once one report cycle (Email → DMARC
Management) shows only Resend and Cloudflare. That is a one-word edit.
Until then a forged `security@skydrop.global` reaches the spam folder
rather than being refused outright.

Cloudflare's own collector is used for `rua` so the reports do not need a
mailbox of their own.

---

## The Cloudflare panel is WRONG about DKIM. Do not act on it

`Email → DMARC Management` shows an "Email record overview" reading:

```
DMARC policy: N/A     SPF policy: N/A     DKIM in use: No (Fail)     BIMI in use: No (Fail)
```

Taken one at a time:

- **DMARC N/A** — true until the record above is published. Fix it.
- **SPF N/A** — true of the ROOT, and expected. Our envelope sender is
  `send.skydrop.global`, which has its own SPF; a root SPF is only
  consulted for mail whose envelope is `@skydrop.global`. Not a fault.
- **DKIM "No / Fail" — FALSE once the record is in.** Our DKIM lives at
  `resend._domainkey.skydrop.global` and is provably resolvable. A DKIM
  selector is an arbitrary label, so a scanner cannot enumerate one without
  being told it; Cloudflare is reporting "I could not find one", not "there
  is none". **Adding a second DKIM record to satisfy this panel would risk
  breaking the signing that works.**
- **BIMI "No"** — a brand logo in the inbox. It needs a paid Verified Mark
  Certificate and DMARC at enforcement first. Not a priority, not a fault.

The lesson worth keeping: a dashboard reporting on records it has to GUESS
the name of will produce false negatives. `dig` the selector.

---

## The root SPF, and why it does not mention SES

The root should carry Cloudflare's include only:

```
skydrop.global  TXT  "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

Our Resend mail uses `send.skydrop.global` as the envelope sender, so the
ROOT SPF is never consulted for it — `send.` has its own. Adding
`include:amazonses.com` here would authorise every SES customer to send
with a root envelope, which is a real weakening for no gain.

`~all` (softfail) rather than `-all` while DMARC sits below enforcement: a
hard fail on a domain we have not finished measuring can bin legitimate
mail from a sender nobody remembered. Tighten it in step with the DMARC
policy, not before.

**Do not remove or edit the SPF on `send.skydrop.global`.** That is the one
our actual outbound path is authenticated by.

---

## Reading it yourself

```bash
dig +short MX  skydrop.global                      # 3x route*.mx.cloudflare.net
dig +short MX  send.skydrop.global                 # SES bounce collector (leave alone)
dig +short TXT resend._domainkey.skydrop.global    # DKIM — this is the one the panel misses
dig +short TXT send.skydrop.global                 # SPF for the envelope
dig +short TXT _dmarc.skydrop.global               # DMARC policy
dig +short TXT cf2024-1._domainkey.skydrop.global  # Cloudflare's forwarding DKIM

# The one that must never be more than one line:
dig +short TXT skydrop.global | grep -c 'v=spf1'   # must be 1
```

---

## The history on `skydrop.online`, kept because it explains the shape

All of the following was measured on the RETIRED domain. It is here because
each item is a mistake the new zone can repeat, not as a statement about
`skydrop.global`.

### 1. No MX on the root — mail to us went nowhere

Until 2026-09-09 there was no MX for `skydrop.online` itself. The `send.`
MX did not help: it is a different name and it points at a bounce
collector, not a mailbox.

With no MX, a sending server falls back to the domain's A record (RFC
5321), which was Cloudflare's proxy — and port 25 there is closed. So the
mail was not rejected quickly; it was retried for hours and came back as a
delayed bounce.

**It was live and invisible.** `sender-resolver.ts` set, on every message:

```
From:     Skydrop <hello@skydrop.online>            (or security@ for auth mail)
Reply-To: Skydrop Support <support@skydrop.online>
```

All three addresses were unreachable. A seller replying to a password
reset, or a customer replying to a dispatch notice, was writing to nobody.
The code was doing exactly what it intends — the domain simply could not
take delivery. **This is the failure the new zone is one forgotten MX away
from**, and the reason the receiving half is set up in the same sitting as
the sending half. `hello@` and `security@` are send-only identities with no
inbox, which is fine as long as `Reply-To` keeps pointing at `support@`.

### 2. No DMARC, then quarantine the same day

`_dmarc.skydrop.online` was empty until 2026-09-09, when it went to
`p=none` for about an hour and then to `p=quarantine; sp=reject`. A message
from `security@skydrop.online` was sent through the real Resend path under
`p=quarantine` and came back `last_event: delivered`. `p=reject` was never
reached before the domain was retired.

### 3. What the move does not change

Resend sends exactly as it did; the mechanism is identical and only the
domain differs. If we ever move the Return-Path onto the root, the SPF
includes have to be MERGED rather than replaced. That is the one change
here that could break outbound.
