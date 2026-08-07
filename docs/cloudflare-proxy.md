# Putting Cloudflare in front of the origin

**Status: DONE for production (2026-08-07).** Kept as the record of what was
changed, why the order mattered, and the one item still open.

| | |
|---|---|
| SSL/TLS mode | ✅ Full (strict) |
| CAA | ✅ already authorises Cloudflare's CAs — see the note below |
| Proxy (orange cloud) | ✅ `skydrop.online`, `www`, `api`, `app`, `admin`, `track` |
| ufw | ✅ 80/443 restricted to Cloudflare ranges; direct-to-IP now times out |
| Caddy real client IP | ✅ `header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}` on all five `reverse_proxy` blocks |
| **`stg-*` records** | ❌ **still DNS-only, still publishing the origin IP** |

### Still open: the four staging records

`stg-api`, `stg-app`, `stg-admin` and `stg-track` are grey-cloud A records
pointing at the same droplet, and Cloudflare's own dashboard flags it: *"A
DNS-only record is revealing an IP address that is hidden by a proxied record."*

They serve **nothing** — there is no Caddy site block for any of them, so the
TLS handshake fails. They are dead records whose only effect is to publish the
origin address that everything else now hides. **Delete them, or proxy them.**
Deleting is cleaner; either needs the dashboard.

### The proof it worked

`audit_logs.metadata.ipAddress` across the cutover, same login endpoint:

```
07:07:39  103.87.214.86     before Cloudflare — real client
08:10:11  172.70.188.148    proxied, before the Caddy fix — a CF EDGE
08:12:48  103.87.214.87     after the Caddy fix — real client again
```

The middle row is the bug this runbook predicted, observed live. Without the
Caddy change the 5-per-15-minutes login limit keys on a Cloudflare edge, so
users sharing a PoP share a bucket and every authentication event is attributed
to Cloudflare.

### Watch the first certificate renewal

Caddy prefers TLS-ALPN-01, which **cannot** complete behind a terminating proxy.
It should fall back to HTTP-01, which Cloudflare passes through. This has not
yet been observed — the current certificates were issued before cutover.

```bash
sudo journalctl -u caddy | grep -i certificate
```

The rollback for that specific failure is `/etc/caddy/Caddyfile.bak-precf` plus
re-opening 80/443, which restores direct ACME.

---

The steps below are the order they were done in, and **the order was the point**:
applying the Caddy change before the firewall would have let anyone forge
`CF-Connecting-IP` straight at the open origin and defeat the login throttle
entirely — worse than the two-hop problem it fixes.

---

## Note on automation

There are no Cloudflare credentials on the droplet or in the repo (no
`~/.cloudflared`, no `CF_API*` in `~/app/.env` or `/etc/caddy/`), so the
dashboard steps — SSL mode, orange cloud, and deleting the `stg-*` records —
cannot be scripted from here.

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
