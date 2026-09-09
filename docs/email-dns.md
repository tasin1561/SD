# Email DNS for skydrop.online — what is set up, what is not, and why

Verified against live DNS on 2026-09-09. Every claim here was checked
with `dig`, not read off a dashboard — see "Reading it yourself" for the
commands, because the Cloudflare panel gets one of these wrong.

---

## The one-line summary

**Resend covers SENDING and it is correctly configured. Nothing covers
RECEIVING.** Mail addressed to anything `@skydrop.online` — including
the `support@` we put in the `Reply-To` of every email we send — is
bouncing.

---

## What is actually in DNS

| Record | Name | What it is for |
|---|---|---|
| TXT | `resend._domainkey.skydrop.online` | **DKIM.** Signs our mail as `@skydrop.online`. |
| TXT | `send.skydrop.online` | **SPF** for the envelope sender: `v=spf1 include:amazonses.com ~all` |
| MX | `send.skydrop.online` | SES's bounce/complaint collector, so Resend learns about failures |
| A | root, `admin`, `api`, `app`, `track`, `www` | the droplet, 68.183.190.55, all proxied |
| CAA | root | Let's Encrypt only |

That is Resend's standard shape and it is right: the **root** domain is
the verified one (hence DKIM at the root), while `send.` is the custom
Return-Path. SPF authenticates the envelope (`send.skydrop.online`),
DKIM authenticates the visible From (`@skydrop.online`), and DMARC will
pass through DKIM alignment.

## What is missing

### 1. No MX on the root — mail to us goes nowhere

There is no MX for `skydrop.online` itself. The `send.` MX does not
help: it is a different name and it points at a bounce collector, not a
mailbox.

With no MX, a sending server falls back to the domain's A record (RFC
5321), which here is Cloudflare's proxy — and port 25 there is closed.
So the mail is not rejected quickly; it is retried for hours and comes
back as a delayed bounce.

**This is live and invisible.** `apps/api/src/modules/email/sender-resolver.ts`
sets, on every message:

```
From:     Skydrop <hello@skydrop.online>            (or security@ for auth mail)
Reply-To: Skydrop Support <support@skydrop.online>
```

All three addresses are unreachable. A seller replying to a password
reset, or a customer replying to a dispatch notice, is writing to
nobody. The code is doing exactly what it intends — the domain simply
cannot take delivery.

**Fix:** Cloudflare → Email → Email Routing → enable. It adds the root
MX itself. Then route at least:

- `support@skydrop.online` → a real inbox (this is the one that matters)
- `api@skydrop.online` → a real inbox (needed for the Shiprocket API
  user, whose password arrives by email — see
  `docs/shiprocket-integration.md`)

### 2. No DMARC

`_dmarc.skydrop.online` is empty.

It matters more here than on an ordinary domain because **this domain
sends password resets**. With no DMARC policy, anyone can forge
`From: security@skydrop.online` and no receiver has been told to reject
it; a spoofed password reset is the highest-value phish available
against a seller. Separately, Gmail and Yahoo have required DMARC from
bulk senders since February 2024, so its absence quietly costs inbox
placement on the mail we do send.

**Fix:** Cloudflare → Email → DMARC Management → Enable. It writes:

```
_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net"
```

`p=none` is deliberate and is not a half-measure: it changes nothing
about delivery and just starts the reports, so we can confirm every
legitimate sender passes BEFORE tightening. Going straight to
`p=reject` on a domain nobody has measured is how you discover a
forgotten sender by having its mail silently dropped. Tighten to
`p=quarantine`, then `p=reject`, once the reports are clean.

Cloudflare's own collector is used for `rua` so the reports do not need
a mailbox of their own.

---

## The Cloudflare panel is WRONG about DKIM. Do not act on it

`Email → DMARC Management` shows an "Email record overview" reading:

```
DMARC policy: N/A     SPF policy: N/A     DKIM in use: No (Fail)     BIMI in use: No (Fail)
```

Only the first is a real problem. Taken one at a time:

- **DMARC N/A** — true. Fix it (above).
- **SPF N/A** — true of the ROOT, and expected. Our envelope sender is
  `send.skydrop.online`, which has its own SPF; a root SPF is only
  consulted for mail whose envelope is `@skydrop.online`. Not a fault.
- **DKIM "No / Fail" — FALSE. Our DKIM exists** at
  `resend._domainkey.skydrop.online` and is provably resolvable. A DKIM
  selector is an arbitrary label, so a scanner cannot enumerate one
  without being told it; Cloudflare is reporting "I could not find one",
  not "there is none". **Adding a second DKIM record to satisfy this
  panel would risk breaking the signing that already works.**
- **BIMI "No"** — a brand logo in the inbox. It needs a paid Verified
  Mark Certificate and DMARC at enforcement first. Not a priority, and
  not a fault.

The lesson worth keeping: a dashboard reporting on records it has to
GUESS the name of will produce false negatives. `dig` the selector.

---

## After Email Routing is on, revisit the root SPF

Cloudflare Email Routing FORWARDS mail, and forwarded mail is re-sent
from Cloudflare's servers using our domain — so once routing is live the
root wants an SPF that includes them. If a root SPF is added, it should
carry both, because SES may also be used with a root envelope:

```
skydrop.online  TXT  "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all"
```

`~all` (softfail) rather than `-all` while DMARC is at `p=none`: a hard
fail on a domain we have not yet measured can bin legitimate mail from a
sender nobody remembered.

**Do not remove or edit the SPF on `send.skydrop.online`.** That is the
one our actual outbound path is authenticated by.

---

## Reading it yourself

```bash
dig +short MX  skydrop.online                      # expect: an MX, once routing is on
dig +short MX  send.skydrop.online                 # SES bounce collector (leave alone)
dig +short TXT resend._domainkey.skydrop.online    # DKIM — this is the one the panel misses
dig +short TXT send.skydrop.online                 # SPF for the envelope
dig +short TXT _dmarc.skydrop.online               # DMARC policy
```

## What none of this changes

Resend keeps sending exactly as it does now. A root MX and a root DMARC
record do not touch the `send.` subdomain, the DKIM key, or the From
addresses in `sender-resolver.ts`. If we ever move the Return-Path onto
the root, the SPF includes have to be merged rather than replaced — that
is the one change here that could break outbound.
