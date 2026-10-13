# Email DNS for skydrop.global

**Status (2026-10-14): BUILT AND MEASURED. `skydrop.global` sends through
TWO providers — Resend for credential mail, Amazon SES for everything
else — and both authenticate.** Proved end to end against Gmail on
2026-10-14: `dkim=pass header.i=@skydrop.global`, `spf=pass
smtp.mailfrom=…@bounce.skydrop.global`, `dmarc=pass (p=QUARANTINE
sp=REJECT dis=NONE)`, delivered to the inbox. Cloudflare Email Routing
receives; DMARC sits at quarantine.

The arrangement mirrors what was live on `skydrop.online` (verified
2026-09-09) with one addition: our OWN SES account, which is the subject
of "Amazon SES — the second sender" below.

**Verify with `dig`, not off a dashboard** — see "Reading it yourself",
because the Cloudflare panel gets one of these wrong.

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
| CNAME ×3 | `<token>._domainkey.skydrop.global` | **OUR SES's DKIM** (Easy DKIM). Three selectors → `<token>.dkim.amazonses.com`. See the SES section. |
| MX | `bounce.skydrop.global` | **OUR SES's** bounce collector: `10 feedback-smtp.ap-south-1.amazonses.com` |
| TXT | `bounce.skydrop.global` | **SPF for OUR SES's envelope**: `v=spf1 include:amazonses.com ~all` |
| A | root, `admin`, `api`, `app`, `client`, `member`, `associate`, `reseller`, `portal`, `track`, `www` | the droplet, 68.183.190.55, all proxied (`docs/cloudflare-proxy.md`) |
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
Management) shows only the senders we expect. That is a one-word edit.
Until then a forged `security@skydrop.global` reaches the spam folder
rather than being refused outright.

**THERE ARE THREE EXPECTED SENDERS, NOT TWO (corrected 2026-10-14).** This
said "only Resend and Cloudflare", which was true when it was written and
became wrong the night our own SES account went live. The reports will
show **Resend** (credential mail), **Amazon SES** (everything else,
NOTIF-24) and **Cloudflare Email Routing** (forwarded inbound). Read
literally, the old sentence would make a correct report look like a
compromise — somebody would see `amazonses.com` sending as us, which is
exactly what an attacker's report looks like, and either panic or stall
the move to enforcement. All three are ours.

**`rua` was enabled on 2026-10-14** and is Cloudflare's own collector, so
the reports need no mailbox:

```
_dmarc  TXT  "v=DMARC1; p=quarantine; sp=reject; fo=1; rua=mailto:<id>@dmarc-reports.cloudflare.net;"
```

Before that the `.global` record carried the policy but **no `rua` at
all** — a partial copy of `.online`'s — so for the whole period this
domain was sending, no authentication failure of any kind was visible to
anyone. The first reports land about 24 hours after enabling it.

---

## The Cloudflare panel is WRONG about DKIM. Do not act on it

`Email → DMARC Management` shows an "Email record overview". **As of
2026-10-14 it reads:**

```
DMARC policy: Quarantine   SPF policy: Soft fail (Warning)   DKIM in use: Yes   BIMI in use: No (Fail)
```

Two of those four are flagging a DELIBERATE choice, and acting on either
would make things worse:

- **DMARC "Quarantine"** — correct and published.
- **SPF "Soft fail" + Warning — EXPECTED, do not "fix" it.** The root
  carries `~all` on purpose (see "The root SPF" below): a hard `-all`
  while DMARC sits below enforcement can bin legitimate mail from a
  sender nobody remembered. Tighten it in step with the DMARC policy,
  never ahead of it. The panel cannot know that and flags the softfail
  on principle.
- **DKIM "Yes"** — now true. It previously read **"No (Fail)" and that
  was a FALSE NEGATIVE**, worth keeping on record because the reasoning
  outlives the reading: a DKIM selector is an arbitrary label, so a
  scanner cannot enumerate one without being told the name. Cloudflare
  was reporting "I could not find one", never "there is none". **Adding
  a DKIM record to satisfy a panel would risk breaking the signing that
  works** — and with three publishers now (Resend, SES, Cloudflare's own
  forwarding key) there is more, not less, to break.
- **BIMI "No (Fail)"** — a brand logo in the inbox. It needs a paid
  Verified Mark Certificate and DMARC at enforcement first. The word
  "Fail" is the panel dramatising an optional feature nobody has
  implemented. Not a priority, not a fault.

The lesson worth keeping: a dashboard reporting on records it has to GUESS
the name of will produce false negatives. `dig` the selector.

---

## Amazon SES — the second sender (2026-10-14)

Resend carries CREDENTIAL mail; **our own SES account carries everything
else** (`EmailProviderRouter`, and its docblock is the authority on why
the category decides). This section is the DNS half.

### The records, and the one that is easy to get wrong

| Type | Name | Value |
|---|---|---|
| CNAME | `2mgzlrordvt3ve767ywgd37dffljbwb4._domainkey` | `2mgzlrordvt3ve767ywgd37dffljbwb4.dkim.amazonses.com` |
| CNAME | `haj5nxwtpdakcbssa64p35ty5p4ty4we._domainkey` | `haj5nxwtpdakcbssa64p35ty5p4ty4we.dkim.amazonses.com` |
| CNAME | `5ecfkprtvbupf63a6af73wwja2pgj6x6._domainkey` | `5ecfkprtvbupf63a6af73wwja2pgj6x6.dkim.amazonses.com` |
| MX | `bounce` | `feedback-smtp.ap-south-1.amazonses.com`, priority 10 |
| TXT | `bounce` | `v=spf1 include:amazonses.com ~all` |

All five **DNS only (grey cloud)**. A proxied DKIM CNAME resolves to
Cloudflare's addresses instead of `…dkim.amazonses.com`, SES never
verifies, and everything still *looks* published.

**`send.` IS RESEND'S. `bounce.` IS OURS. They are not interchangeable
and they look identical.** Both carry `v=spf1 include:amazonses.com ~all`
and an MX to a `feedback-smtp.*.amazonses.com` host, because **Resend
resells Amazon SES** — so Resend's records are SES records, for Resend's
account. The tells are the name and the region: `send.` →
`ap-north**east**-1` (Tokyo, Resend's), `bounce.` → `ap-south-1` (Mumbai,
ours, account 328354325534). Pointing our MAIL FROM at `send.` would post
our bounces into Resend's collector.

### Two silent failures this setup actually hit

**A one-letter typo in a record NAME is invisible.** The SPF TXT was first
published on `bounch.skydrop.global`. Cloudflare accepted it, the row
rendered green, nothing errored — and SPF for `bounce.skydrop.global`
would simply never have resolved, for ever. Caught only by querying the
name that matters (`dig TXT bounce.skydrop.global`) rather than reading
the dashboard. **Verify a record by asking DNS for the name the software
will ask for.**

**An ADDRESS identity is not a DOMAIN identity.** Four SES sends on
2026-09-27 succeeded through a single-address identity
(`hello@skydrop.global` verified by clicking a link). That needs no DNS,
gets no DKIM of its own, and SES then signs `d=amazonses.com` — which
aligns with nothing under `p=quarantine`. They would have been
quarantined while `notification_logs` recorded them `sent`, because SES
accepting an API call says nothing about delivery. **Always verify the
DOMAIN.**

### What was measured, 2026-10-14

A realistic transactional message sent through the app's own compiled
SigV4 signer and `buildSesPayload`, from `hello@skydrop.global` to a
Gmail address:

```
dkim=pass   header.i=@skydrop.global  header.s=2mgzlrordvt3ve767ywgd37dffljbwb4
dkim=pass   header.i=@amazonses.com                      (SES's own second signature)
spf=pass    smtp.mailfrom=…@bounce.skydrop.global        designates 76.223.180.23
dmarc=pass  (p=QUARANTINE sp=REJECT dis=NONE)            header.from=skydrop.global
Return-Path: …@bounce.skydrop.global
Received: from c180-23.smtp-out.ap-south-1.amazonses.com
```

**Two independent paths to a DMARC pass** — SPF aligned via `bounce.`,
DKIM aligned via the root — which is the whole reason the custom MAIL
FROM is worth the two extra records. Delivered to the inbox.

**A perfectly authenticated email can still be filtered.** The first test
— subject `test`, body `test`, from an identity with no sending history —
went to spam, and Gmail said "similar to messages that were identified as
spam in the past". That is the CONTENT/reputation verdict, not the
authentication one, which reads "has failed skydrop.global's required
tests for authentication". **Tell the two apart before changing any
DNS**; the same message with real content landed in the inbox.

### Only one of the three DKIM selectors resolves, and that is fine

`2mgzlrordvt…` carries a key; the other two return nothing. Our three
CNAMEs are correct and point at the right targets — AWS populates the key
AT those targets, and signs only with a selector it has published (the
header above confirms it chose the live one). Nothing to chase; if AWS
publishes the others they resolve through our records automatically.

### Credentials

`AWS_SES_REGION=ap-south-1` plus an IAM access key, in `~/app/.env` on the
droplet, read by `SesService` (CUR-1 discipline: the secret is in env,
never the database). The IAM user `skydrop-ses-sender` carries ONE inline
policy — `ses:SendEmail` / `ses:SendRawEmail` on
`arn:aws:ses:ap-south-1:328354325534:identity/skydrop.global` and nothing
else, so a leaked key can send as `@skydrop.global` and cannot read
reputation metrics, delete an identity, or send as `skydrop.online`.
**SES is inert by absence** — remove the three variables and every message
routes to Resend exactly as before, with no code change.

## The root SPF, and why it does not mention SES

The root should carry Cloudflare's include only:

```
skydrop.global  TXT  "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

Our Resend mail uses `send.skydrop.global` as the envelope sender and our
own SES mail uses `bounce.skydrop.global`, so the ROOT SPF is never
consulted for either — each has its own. Adding `include:amazonses.com`
here would authorise every SES customer on earth to send with a root
envelope, which is a real weakening for no gain, and it would do so while
looking like it was helping the very path that does not use it.

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
