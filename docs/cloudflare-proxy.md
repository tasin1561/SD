# Putting Cloudflare in front of the origin

**Status: PARTLY DONE.**

- ✅ **SSL/TLS mode is already Full (strict)** — step 1 is complete.
- ✅ **CAA already permits Cloudflare's CAs.** The dashboard row shows only
  `letsencrypt.org`, which looks like it would block Cloudflare's edge
  certificate; the full record set also authorises `pki.goog`, `digicert.com`,
  `comodoca.com` and `ssl.com`, so Universal SSL can issue. Checked with
  `dig +short skydrop.online CAA` rather than read off the row.
- ❌ All fourteen A records are still **grey-cloud (DNS only)**, so every
  request reaches the droplet directly: no CDN, no WAF, no DDoS absorption.
- ❌ `ufw` still allows 80/443 from anywhere.
- ❌ Caddy does not yet read `CF-Connecting-IP`.

Note the staging hostnames (`stg-api`, `stg-app`, `stg-admin`, `stg-track`)
point at the **same droplet** as production. Whatever is decided about proxying
applies to them too.

This file is the runbook. **The steps are ordered, and the order is the point** —
doing step 3 before steps 1 and 2 opens a header-spoofing hole that is worse
than the situation it replaces.

---

## Why it is not already done

Two of the four steps need the Cloudflare dashboard, and there are no Cloudflare
credentials on the droplet or in the repo (checked: no `~/.cloudflared`, no
`CF_API*` in `~/app/.env` or `/etc/caddy/`). So this cannot be automated from
here; a human with dashboard access has to do steps 1 and 2.

---

## What breaks if you just flip the switch

### 1. The login throttle stops working

`apps/api/src/main.ts:29` sets `app.set('trust proxy', 1)` — trust exactly one
hop. Today the chain is:

```
client → Caddy → API          XFF = "client"        req.ip = client   ✅
```

Adding Cloudflare makes it two hops:

```
client → Cloudflare → Caddy → API   XFF = "client, cf-edge"   req.ip = cf-edge   ❌
```

`AppThrottlerGuard.getTracker()` keys on `req.ip`. With every request appearing
to come from a Cloudflare edge, the 5-per-15-minutes login limit becomes a
**shared bucket per Cloudflare PoP** — a handful of users in the same city lock
each other out, and `audit_logs.ipAddress` records Cloudflare's IPs instead of
the client's for every authentication event.

The fix is step 3, and it MUST come after step 2.

### 2. The origin stays reachable anyway

`ufw` currently allows 80/443 from anywhere. Proxying without restricting the
origin is half a mitigation: anyone with the IP simply skips Cloudflare.

The origin is `68.183.190.55`. It is no longer in any tracked file — it was a
fixture in `ssrf-guard.spec.ts`, now replaced — but it appears in **141 commits
of history**, and removing a line does not remove it from the past. Assume it is
known. (The IP that was in `docs/cicd.md`, `157.245.109.39`, was a STALE address
from an earlier droplet and never pointed here.)

### 3. Certificate renewal

Caddy issues from Let's Encrypt and tries TLS-ALPN-01 before HTTP-01.
**TLS-ALPN-01 cannot work behind a proxy** — Cloudflare terminates TLS, so the
challenge never reaches Caddy. Caddy falls back to HTTP-01, which Cloudflare
does pass through, so renewals should self-heal. Watch the first renewal after
cutover rather than assuming; `journalctl -u caddy | grep -i certificate`.

---

## The runbook, in order

### Step 1 — Cloudflare dashboard: SSL mode first

Set SSL/TLS mode to **Full (strict)** *before* enabling the proxy. Caddy serves
real Let's Encrypt certificates, so strict validates correctly. Flipping the
proxy on while the mode is "Flexible" would make Cloudflare talk HTTP to the
origin and put the site in a redirect loop.

### Step 2 — Restrict the origin to Cloudflare, THEN enable the proxy

```bash
# On the droplet. Cloudflare publishes its ranges; fetch them rather than
# pasting a list that goes stale.
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done
for ip in $(curl -s https://www.cloudflare.com/ips-v6); do sudo ufw allow from "$ip" to any port 80,443 proto tcp; done
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
sudo ufw status numbered
```

Keep the OpenSSH rule. Do **not** run the two `delete` lines until the proxy is
on and serving, or you lock the site out of the internet.

Then in the dashboard, switch the A records for `skydrop.online`, `www`, `api`,
`app`, `admin`, `track` from grey cloud to **orange cloud**.

### Step 3 — Only now: make Caddy pass the real client IP

Add to **each** site block in `/etc/caddy/Caddyfile`:

```
reverse_proxy 127.0.0.1:PORT {
	header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
}
```

**Why this and not `trust proxy: 2`:** counting hops is brittle — it silently
breaks again the next time something is added to the chain. Overwriting XFF with
the one header Cloudflare guarantees leaves the API's `trust proxy: 1` correct
and unchanged.

**Why it must come after step 2:** `CF-Connecting-IP` is a plain request header.
Until the origin only accepts Cloudflare traffic, anyone can send it directly to
the droplet and forge their own IP — which would let a single attacker defeat
the login throttle entirely. Trusting that header on an open origin is strictly
worse than the two-hop problem it fixes.

### Step 4 — Verify, do not assume

```bash
# real client IP reaching the app, not a Cloudflare edge
sudo journalctl -u caddy -f          # watch a request come through

# the origin is no longer directly reachable
curl -sS --max-time 10 https://<origin-ip>/ -H 'Host: api.skydrop.online' -k   # expect a timeout

# the throttle still keys per client: six bad logins from one machine
# should 429 on the sixth, and NOT affect a different machine
```

Check `audit_logs.ip_address` on a fresh login and confirm it is a real client
address rather than `172.6x.x.x`.

---

## Also worth doing at the same time

- **Reboot for the pending kernel patch.** Flagged in the 2026-07-28 security
  round and still outstanding; pm2, Caddy and Docker all resurrect cleanly, so
  it is an outage window rather than a risk.
- Once proxied, Cloudflare's WAF and rate limiting become available and are
  worth a pass of their own — the app-level throttle is per-route and does
  nothing about volumetric traffic.
