# Email DNS for skydrop.online

Verified against live DNS on 2026-09-09, after the receiving side was
built the same day. Every claim here was checked with `dig`, not read
off a dashboard — see "Reading it yourself", because the Cloudflare
panel gets one of these wrong.

---

## The one-line summary

**Resend sends. Cloudflare Email Routing receives. Both are live.**

Until 2026-09-09 the second half did not exist: there was no MX on the
root at all, so every message we sent carried a `Reply-To` at a domain
that could not take delivery, and every reply was retried for hours and
bounced. That is fixed; the reasoning is kept below because it is the
kind of thing that gets undone by somebody tidying DNS.

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

## Receiving — Cloudflare Email Routing (added 2026-09-09)

| Record | Name | Value |
|---|---|---|
| MX | root | `route1.mx.cloudflare.net` (35), `route2` (9), `route3` (62) |
| TXT | root | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| TXT | `cf2024-1._domainkey` | Cloudflare's DKIM, for mail it FORWARDS |

Forwarding rules, both to `chwhdev@gmail.com`:

- `support@skydrop.online` — the `Reply-To` on every message we send
- `api@skydrop.online` — where Shiprocket mails the API user's password
  (`docs/shiprocket-integration.md`)

**Two DKIM keys is correct, not a mistake.** DKIM is selector-scoped:
Resend signs with `resend`, Cloudflare signs forwarded mail with
`cf2024-1`, and each signature names its own selector. A domain may hold
any number. **SPF is the opposite** — two SPF records on one name is a
permerror, which is why the root has exactly one and why nothing should
add another. If SES ever needs to send with a ROOT envelope, MERGE the
include into the existing record; never add a second.

Verified end to end on the day: a real message through Resend to
`support@skydrop.online` came back `last_event: delivered`, meaning
Cloudflare's servers accepted mail for an address that had no MX behind
it an hour earlier.

## The history, kept because it explains the shape

### 1. No MX on the root — mail to us went nowhere

There was no MX for `skydrop.online` itself. The `send.` MX did not
help: it is a different name and it points at a bounce collector, not a
mailbox.

With no MX, a sending server falls back to the domain's A record (RFC
5321), which here is Cloudflare's proxy — and port 25 there is closed.
So the mail was not rejected quickly; it was retried for hours and came
back as a delayed bounce.

**It was live and invisible.** `apps/api/src/modules/email/sender-resolver.ts`
sets, on every message:

```
From:     Skydrop <hello@skydrop.online>            (or security@ for auth mail)
Reply-To: Skydrop Support <support@skydrop.online>
```

All three addresses were unreachable. A seller replying to a password
reset, or a customer replying to a dispatch notice, was writing to
nobody. The code was doing exactly what it intends — the domain simply
could not take delivery. `support@` and `api@` are routed now; the other
two (`hello@`, `security@`) are send-only identities and still have no
inbox, which is fine as long as `Reply-To` keeps pointing at `support@`.

### 2. No DMARC

`_dmarc.skydrop.online` is empty.

It matters more here than on an ordinary domain because **this domain
sends password resets**. With no DMARC policy, anyone can forge
`From: security@skydrop.online` and no receiver has been told to reject
it; a spoofed password reset is the highest-value phish available
against a seller. Separately, Gmail and Yahoo have required DMARC from
bulk senders since February 2024, so its absence quietly costs inbox
placement on the mail we do send.

**Done 2026-09-09** via Cloudflare → Email → DMARC Management → Enable,
which wrote:

```
_dmarc  TXT  "v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net"
```

**It is still at `p=none`, which only WATCHES.** That is deliberate and
not a half-measure: it changes nothing
about delivery and just starts the reports, so we can confirm every
legitimate sender passes BEFORE tightening. Going straight to
`p=reject` on a domain nobody has measured is how you discover a
forgotten sender by having its mail silently dropped.

**The remaining work is to finish this.** Once the reports show only
Resend and Cloudflare sending as us, move to `p=quarantine` and then
`p=reject`. Until then a forged `security@skydrop.online` is still
deliverable — the policy is observing it, not stopping it.

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

## The root SPF, and why it does not mention SES

The root carries Cloudflare's include only:

```
skydrop.online  TXT  "v=spf1 include:_spf.mx.cloudflare.net ~all"
```

That is correct as things stand. Our Resend mail uses
`send.skydrop.online` as the envelope sender, so the ROOT SPF is never
consulted for it — `send.` has its own. Adding `include:amazonses.com`
here would authorise every SES customer to send with a root envelope,
which is a real weakening for no gain.

`~all` (softfail) rather than `-all` while DMARC sits at `p=none`: a
hard fail on a domain we have not finished measuring can bin legitimate
mail from a sender nobody remembered. Tighten it in step with the DMARC
policy, not before.

**Do not remove or edit the SPF on `send.skydrop.online`.** That is the
one our actual outbound path is authenticated by.

---

## Reading it yourself

```bash
dig +short MX  skydrop.online                      # 3x route*.mx.cloudflare.net
dig +short MX  send.skydrop.online                 # SES bounce collector (leave alone)
dig +short TXT resend._domainkey.skydrop.online    # DKIM — this is the one the panel misses
dig +short TXT send.skydrop.online                 # SPF for the envelope
dig +short TXT _dmarc.skydrop.online               # DMARC policy
dig +short TXT cf2024-1._domainkey.skydrop.online  # Cloudflare's forwarding DKIM

# The one that must never be more than one line:
dig +short TXT skydrop.online | grep -c 'v=spf1'   # must be 1
```

## What none of this changed

Resend sends exactly as it did. The root MX, the root SPF, the second
DKIM key and the DMARC record do not touch the `send.` subdomain, the
`resend` DKIM key, or the From addresses in `sender-resolver.ts` — the
delivery test above went out through that path unchanged.

If we ever move the Return-Path onto the root, the SPF includes have to
be MERGED rather than replaced. That is the one change here that could
break outbound.
