# Skydrop — Infrastructure Specification

**Project:** Skydrop — Cross-Border Courier Aggregator + Light WMS
**Phase:** 1A (pre-launch)
**Sellers:** Bangladesh-based e-commerce merchants
**Customers:** Indian shoppers
**Couriers:** Delhivery primary + other Indian couriers as fallback
**Last Updated:** 2026-05-14
**Status:** ✅ Provisioned

---

## 1. Overview

Skydrop is a cross-border courier aggregator with a light warehouse management layer. Bangladeshi sellers ship inventory to Skydrop's warehouse in India; Skydrop receives, stores, picks, packs, and dispatches via Indian couriers (primarily Delhivery) to Indian end customers. Phase 1A focuses on operations — pricing is calculated and displayed but money flows are handled manually offline. Phase 1B will add seller wallet, GST invoicing, and cross-border COD remittance.

All infrastructure runs on **DigitalOcean** with **Cloudflare** at the edge. Deliberately conservative architecture — start simple on one droplet, scale by upgrading components rather than re-architecting.

---

## 2. Technology Stack

### Frontend
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS + shadcn/ui
- **i18n:** English (all portals) + Hindi (tracking page)

### Backend
- **Framework:** NestJS
- **Language:** TypeScript (strict)
- **ORM:** Prisma
- **API:** REST + OpenAPI/Swagger

### Database
- **Engine:** PostgreSQL 18 (DigitalOcean Managed)
- **Extensions:**
  - **TimescaleDB** — `tracking_events` table as a hypertable (time-series optimization, compression)
  - **PostGIS** — (optional, may not be required for Phase 1A; install if zone-based pricing needs it)

### Cache / Queue
- **Redis** — on the droplet (sessions, cache, rate limiting, BullMQ backend)
- **BullMQ** — Redis-backed background job queue
  - Emails, SMS, webhook delivery, Delhivery status sync, FX rate fetch, CSV bulk-upload processing, label generation

### Storage
- **DigitalOcean Spaces** (S3-compatible) — proof-of-delivery photos, AWB label PDFs, customs/invoice documents, seller product images, bulk CSV upload files

### Edge / Network
- **Cloudflare** — DNS ONLY, as actually configured (verified 2026-07-28). The records are unproxied A-records pointing straight at the droplet, so there is NO CDN, NO WAF, NO DDoS absorption in front of the origin, and the origin IP is public in DNS. TLS is terminated by Caddy on the droplet with Let's Encrypt, not by Cloudflare. This line used to claim CDN + DDoS + SSL termination; it never did any of them. Turning the proxy on is a real decision (upload size caps, websocket behaviour, and a second CSP-capable layer) and has not been taken.
- **Caddy** — reverse proxy on the droplet (routes subdomains to internal Node apps; also file-serves the static marketing export from `/var/www/skydrop-marketing`). Config: `/etc/caddy/Caddyfile`. Automatic HTTPS. NOT Nginx — this doc said Nginx until 2026-07-27 and the droplet never ran it.

### Communications
- **Email:** Resend or Postmark (TBD — decided before notifications module)
- **SMS:** Twilio (Indian customer + BD seller alerts)

### Authentication
- Custom auth in NestJS using Passport.js + JWT + refresh tokens
- bcrypt for password hashing
- Role-based access control (RBAC) for staff; data-scoped access for sellers
- Separate JWT audiences for seller portal vs admin portal
- No third-party auth provider — keeps all identity data inside Skydrop

### Live Chat
- **ChatWoot** — self-hosted on a small additional droplet (sized later)
- Embedded in seller portal; admin/support uses ChatWoot's own dashboard

### Monitoring / Logging
- **Sentry** — application error tracking (free tier to start)
- **DigitalOcean built-in monitoring** — droplet & DB metrics + alerts
- **Pino** — structured app logging → file → optionally ship to Better Stack / Logtail later

---

## 3. Subdomain Map

**Domain cutover (2026-10-04): the estate moved from `skydrop.online` to
`skydrop.global`, and this section describes the DESTINATION, not yet the
live state.** On the day of the rename only the `skydrop.global` apex and
`www` resolved; none of the five app subdomains below existed, and every
"put live" / "verified" sentence in this document was true of
`skydrop.online`. `skydrop.online` is retired once `.global` serves, so
treat the DNS, Caddy and Cloudflare steps here as a checklist to re-run on
the new zone rather than a record of work already done on it. The one place
to reason from is the zone and the droplet, never this file.

| Subdomain | Purpose | App in monorepo |
|---|---|---|
| `skydrop.global` | Public marketing site | `apps/marketing` |
| `app.skydrop.global` | Seller portal (BD merchants) | `apps/seller` |
| `admin.skydrop.global` | Staff portal (admin, call center, warehouse) | `apps/admin` |
| `track.skydrop.global` | Branded public tracking (Indian customers) | `apps/track` |
| `api.skydrop.global` | Backend API (consumed by all front-ends + B2B clients) | `apps/api` |
| `reseller.skydrop.global` | Reseller store portal (RS-2) — pm2 `skydrop-reseller`, 127.0.0.1:3005 | `apps/reseller` |
| `portal.skydrop.global` | Associate portal (ASSOC-1) — pm2 `skydrop-associate`, 127.0.0.1:3007 | `apps/associate` |

All seven subdomains terminate at Cloudflare → forwarded to Caddy on the droplet → routed to the appropriate Node process on internal port.

**pm2 runs SEVEN processes** once both portals are started: `skydrop-api`,
`skydrop-portal` (the courier-portal browser worker — a different thing
entirely from `skydrop-associate`, and the two names are close enough to be
worth saying so), `skydrop-admin`, `skydrop-seller`, `skydrop-track`,
`skydrop-reseller` and `skydrop-associate`. `ecosystem.config.cjs` is the
list; `pm2 list` is the truth.

### `portal.skydrop.global` (ASSOC-1, added 2026-10-08)

**The hostname needs the owner's confirmation before the DNS record is
created.** `portal` is their own choice of subdomain; the TLD is `.global`
here because §Domain cutover retires `skydrop.online` once `.global`
serves, and standing a new app up on the domain being retired would mean
doing the DNS, the Caddy block and the certificate twice. Nothing in the
app is baked to it — the hostname lives in exactly two places, one Caddy
block and one DNS record, so changing it costs a reload.

The repo side ships with the code (`apps/associate`, the
`skydrop-associate` entry in `ecosystem.config.cjs`, the build / restart /
health lines in `scripts/deploy.sh`, and the build in CI's `browser` job).
The three owner steps, modelled exactly on RS-12's above:

1. **DNS** — a Cloudflare A record `portal` → the droplet, **proxied** like
   the others, behind the firewall + `CF-Connecting-IP` arrangement in
   `docs/cloudflare-proxy.md`. **ufw needs no new rule**: 3007 is bound to
   loopback (`-H 127.0.0.1` in the ecosystem entry), so it is not on the
   droplet's public or VPC address at all and there is nothing to filter.
   The firewall rules that matter are the existing 80/443 ones restricted
   to Cloudflare's ranges.
2. **Caddy** — a block beside `reseller.skydrop.global`'s, identical except
   for the host and the port. It proxies to loopback; the app sets its own
   security headers and nonce CSP (`packages/config`), so **Caddy adds
   none** — a CSP from both places is intersected by the browser and blocks
   Next's own scripts:

   ```caddy
   portal.skydrop.global {
     encode zstd gzip
     reverse_proxy 127.0.0.1:3007 {
       header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
     }
   }
   ```

   (Copy the `header_up` / `trusted_proxies` lines exactly as the live
   `app.skydrop.global` block has them rather than this sketch — the live
   block is the one that has been verified against the login throttle.)
   Then `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
3. **pm2** — after a deploy has built `apps/associate`:
   `pm2 start ecosystem.config.cjs --only skydrop-associate && pm2 save`.
   `deploy.sh` health-checks `127.0.0.1:3007/login` only once pm2 knows the
   process, so deploys before this step do not fail on it. **And
   `deploy.sh` changes apply ONE DEPLOY LATE** — the running script is the
   one that was on disk when the deploy started — so the first deploy after
   this lands will neither build nor health-check the app. Build it by hand
   once, then start it (the commands are in that section's runbook).

**Port 3007, not 3006.** 3006 is `apps/marketing`'s local dev/serve port
and `MARKETING_PORT` in the root `playwright.config.ts`. Two apps on one
port collide in `pnpm dev` and, worse, in Playwright's `webServer` array,
where the second to boot finds the first already answering and every spec
then runs against the wrong site, passing.

**Env:** the associate app itself needs only `API_ORIGIN`, which the
ecosystem entry already sets. If the API ever gains an `ASSOCIATE_APP_URL`
— for the links in an associate's invitation and password-reset mail —
set it in `~/app/.env` beside `RESELLER_APP_URL`; until then those mails
link to the reseller portal, which is the wrong front door for an
associate and is worth checking before the first invitation goes out.

### `reseller.skydrop.global` (RS-12, added 2026-09-14)

The repo side ships with the code (`apps/reseller`, the `skydrop-reseller`
entry in `ecosystem.config.cjs`, the build/restart/health lines in
`scripts/deploy.sh`). **DNS and Caddy were put live by the owner on
2026-09-14** (`reseller.skydrop.global` → `127.0.0.1:3005`); what remains
is the pm2 start below, once a deploy has built the app. For the record,
the three owner steps were:

1. **DNS** — a Cloudflare A record `reseller` → the droplet, **proxied**
   like the others, behind the firewall + `CF-Connecting-IP` arrangement in
   `docs/cloudflare-proxy.md`.
2. **Caddy** — a block beside `app.skydrop.global`'s, identical except for
   the host and port. It proxies to loopback; the app sets its own security
   headers and nonce CSP (`packages/config`), so Caddy adds none:

   ```caddy
   reseller.skydrop.global {
     encode zstd gzip
     reverse_proxy 127.0.0.1:3005 {
       header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
     }
   }
   ```

   (Copy the `header_up` / `trusted_proxies` lines exactly as the live
   `app.skydrop.global` block has them rather than this sketch — the live
   block is the one that has been verified against the login throttle.)
   Then `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy`.
3. **pm2** — after a deploy has built `apps/reseller`:
   `pm2 start ecosystem.config.cjs --only skydrop-reseller && pm2 save`.
   `deploy.sh` health-checks `127.0.0.1:3005/login` only once pm2 knows the
   process, so deploys before this step do not fail on it.

**Env:** set `RESELLER_APP_URL=https://reseller.skydrop.global` in
`~/app/.env` (the API's links in store invitation / password-reset /
verification emails). It defaults to that value when unset, so this is
belt-and-braces rather than a blocker. The reseller app itself needs only
`API_ORIGIN`, which the ecosystem entry already sets.

---

## 4. Architecture Diagram

```
                ┌───────────────┐
                │  Cloudflare   │  (DNS, CDN, DDoS, SSL)
                └───────┬───────┘
                        │
                ┌───────▼────────┐
                │  Droplet       │
                │  (Bangalore)   │
                │  ┌──────────┐  │
                │  │  Caddy   │  │
                │  └────┬─────┘  │
                │       │        │
                │  ┌────▼─────────────────┐   ┌──────────────────┐
                │  │ Next.js × 4 (apps)   │   │ Managed Postgres │
                │  │ NestJS API           │──▶│ (Bangalore)      │
                │  │ BullMQ Workers       │   │ + TimescaleDB    │
                │  └────┬─────────────────┘   └──────────────────┘
                │       │                              ▲
                │  ┌────▼─────┐                        │
                │  │  Redis   │                        │
                │  └──────────┘                        │
                └────────────────┘                     │
                        │                              │
                        ▼                              │
                ┌──────────────────┐                   │
                │ DO Spaces (SGP1) │◀──────────────────┘
                │ PoD, labels,     │
                │ invoices, SKU    │
                │ images, CSVs     │
                └──────────────────┘
```

---

## 5. Provisioned Resources

| Resource | Spec | Region | Monthly Cost |
|---|---|---|---|
| Droplet `skydrop-app-prod` | 4 GB RAM / 2 vCPU / 120 GB NVMe (Premium Intel) | Bangalore (BLR1) | ~$32 |
| Managed PostgreSQL 18 `skydrop-db-prod` | 1 GB RAM / 1 vCPU / 10 GB + storage autoscale | Bangalore (BLR1) | ~$15 |
| Spaces bucket `skydrop-storage` | 250 GB + CDN, restricted listing | Singapore (SGP1) — BLR unavailable | $5 |
| Droplet backups (daily, usage-based) | per GiB of data the droplet holds (~16 GB) | — | a few $ |
| Cloudflare | Free tier | Global | $0 |
| Sentry | Free tier | — | $0 |
| **Total fixed monthly cost** | | | **~$58** |

**Variable costs (not yet active):**
- Email + SMS — usage-based (budget $20–50/month at low volume)
- ChatWoot droplet — small ($6–12/month, when stood up)

---

## 6. Locked Decisions

✅ DigitalOcean for all infrastructure except Cloudflare
✅ PostgreSQL 18 + TimescaleDB as the single primary database
✅ Droplet hosts Node apps, Redis, and workers together for Phase 1A (split later as needed)
✅ Spaces (SGP1) for all user-uploaded files — never the droplet disk
✅ Managed Postgres (not self-hosted) — non-negotiable for production data
✅ Cloudflare in front of all subdomains from day one
✅ Email + SMS via SaaS providers — no self-hosting transactional email
✅ Custom auth (Passport + JWT) — no Clerk/Auth0/Supabase Auth
✅ Subdomain split: marketing / seller / admin / tracking / api
✅ Bangalore region for compute + DB (lowest latency to Delhivery's API and IN users)

---

## 7. Hardening Applied to Droplet (`skydrop-app-prod`)

- ✅ UFW firewall — only 22, 80, 443 open externally
- ✅ Root SSH login disabled
- ✅ Password authentication disabled (key-only)
- ✅ Non-root user `skydrop` with sudo
- ✅ `fail2ban` installed and active
- ✅ Automatic security updates (`unattended-upgrades`) enabled
- ✅ Kernel 6.8.0-111-generic (latest at provision time)
- ✅ DigitalOcean Trusted Sources configured — only droplet can reach managed Postgres
- ⏳ Postgres connection from app uses VPC private network (configure in app env)

---

## 7b. Shiprocket panel egress — two routes, both loopback-only

Shiprocket's SELLER PANEL (`app.shiprocket.in`) is driven by a headless
browser in the `skydrop-portal` process for the nightly wallet sync and
invoice check. Their API (`apiv2.shiprocket.in`, our adapter) is not
involved and goes out normally.

The browser NEVER connects directly — `courier.shiprocket_portal_proxy`
is the single reader of which route it takes, and an empty value stops
the panel automation outright. Two routes exist on the app server, and
**nothing else on the droplet uses either of them**:

| Route | Setting value | What it is |
|---|---|---|
| Bangalore SSH tunnel | `socks5://127.0.0.1:1081` | `shiprocket-egress-tunnel.service` — `ssh -D` to the egress droplet `143.110.188.167` |
| NordVPN container | `http://127.0.0.1:1082` | `shiprocket-vpn.service` — gluetun pinned by digest, WireGuard to a NordVPN India server, exits in Mumbai |

Both bind to **loopback only**. The host's own routing is untouched: the
API, Postgres, Redis, Caddy, Cloudflare and Spaces keep the egress they
always had, and the droplet's default route is NOT the VPN.

### The NordVPN container

Installed and managed by `scripts/infra/shiprocket-vpn.sh`, which also
carries the reasoning in its header:

```
sudo bash scripts/infra/shiprocket-vpn.sh install      # first time, or to update
sudo shiprocket-vpn status                             # is it up, and where does it come out
sudo shiprocket-vpn rotate-key                         # re-derive from the token, pick a new server
sudo shiprocket-vpn uninstall                          # remove it entirely
sudo systemctl restart shiprocket-vpn                  # ordinary restart (re-picks today's server)
sudo journalctl -u shiprocket-vpn -f                   # what it is doing
```

- **The only secret is the NordVPN ACCESS TOKEN** at
  `/home/skydrop/.config/nordvpn/token` (0600). The WireGuard key and the
  server are derived from it by an `ExecStartPre` on every start, into
  `gluetun.env` beside it. The token, that env file and the unit are all
  in the hourly off-site backup (BACKUP-1).
- **gluetun runs as `custom`, not as its `nordvpn` provider.** As
  `nordvpn` it picks servers from a list baked into the image whose India
  entries (`81.17.122.x`) complete no handshake, and its healthcheck
  restarts re-pick a server and ignore a pinned endpoint — which is how a
  run configured for India ended up egressing in Atlanta on 2026-09-28.
  As `custom` there is no list and no rotation; choosing the server is
  the script's job, from NordVPN's live recommendations API.
- **It fails closed.** gluetun's own firewall carries no traffic at all
  while the tunnel is down or reconnecting, so a browser pointed at its
  proxy fails rather than quietly going out directly.

### Is the VPN the cause of a failure?

`GET http://127.0.0.1:8001/v1/publicip/ip` on the droplet, or
`sudo shiprocket-vpn status`. `{"public_ip":""}` means the tunnel is not
carrying traffic.

Without SSHing in: **/cost-sync**, in the "Shiprocket website access"
card, prints the route and the address it comes out at in one line. It
is red when a run would be refused.

The API asks the same question before every panel run, via
`courier.shiprocket_portal_egress_check_url` (the control server) and
`courier.shiprocket_portal_egress_country` (what it must say). **Set
those two only while the proxy IS the VPN** — pointed at a VPN the
browser does not use, they would vouch for an egress nothing goes
through. Both EMPTY is the correct state for the SSH tunnel, which has no
control server to ask.

### Rollback to the Bangalore tunnel

A settings change, no deploy — **but read the section below first: the
tunnel's address is refused by Shiprocket's edge, so this is a rollback
to a route that does not work.** It is here for the case where the VPN
itself is the fault and a failing-for-a-known-reason route is preferable
to a failing-for-an-unknown-one.

1. `/settings` → `courier.shiprocket_portal_proxy` = `socks5://127.0.0.1:1081`
2. `/settings` → clear `courier.shiprocket_portal_egress_check_url`
3. optionally `sudo systemctl disable --now shiprocket-vpn`

The tunnel is left installed, enabled and running at all times; it is not
disturbed by any of the above.

### The VPN IS the live route (corrected 2026-09-29)

The paragraph that stood here said the VPN "did not fix it" and was left
installed and unused. **That was wrong, and the measurement behind it was
an artefact** — it sent a bare `OPTIONS` with no `Origin` and no
`Access-Control-Request-*` headers, which is not a CORS preflight and
answers 403 from every vantage point including the one that works.

A correctly-formed preflight for
`apiv2.shiprocket.co/v1/auth/login/user`, five times per cell:

| Egress | with a `Chrome/…` UA | with a `HeadlessChrome/…` UA |
|---|---|---|
| NordVPN Mumbai `187.13.246.12` | **200** | 403 |
| app droplet `68.183.190.55` | 403 | 403 |
| egress droplet `143.110.188.167` | 403 | 403 |

**Two independent signals, ANDed**, which is why changing one at a time
proved nothing. The address half is this section; the browser half is
`desktopChromeUserAgent` in `shiprocket-portal-session.service.ts`. The
live setting is therefore `courier.shiprocket_portal_proxy` =
`http://127.0.0.1:1082`, with the two egress-check settings SET.

**The VPN re-picks a server on every restart**, and a future exit could
be on the same reputation list. The sign-in now asks the edge one
credential-free preflight before it decrypts a password, so that arrives
as `shiprocket-portal-egress:<account>` naming a blocked address rather
than as a burnt login attempt read as an expired session. The remedy is
`sudo shiprocket-vpn rotate-key`, then re-run from /cost-sync.

**The Bangalore tunnel stays installed and running**, but it is NOT a
working route for the panel any more — rolling back to it restores the
nightly failures. See `docs/shiprocket-integration.md`.

---

## 8. Scaling Triggers

Upgrade components only when these thresholds are hit:

| Trigger | Action |
|---|---|
| Postgres CPU > 70% sustained | Upgrade DB plan (one click in DO) |
| Droplet RAM > 80% sustained | Resize droplet |
| Redis memory > 70% | Move Redis to DO Managed Redis or Upstash |
| > 50K active sellers, or workers need own host | Split workers onto a second droplet |
| Reports / analytics slow main DB | Add read replica or ClickHouse |
| `tracking_events` > 50M rows | Enable TimescaleDB compression policies |
| Postgres full-text search slow on tracking lookup | Add Meilisearch |
| Phase 1B launch with paying sellers | Add a standby node for failover (PITR is already included on the basic tier) |

---

## 9. Data Protection Strategy

Layered approach — no single "dual database" replaces this:

| Layer | Protects against | Active? |
|---|---|---|
| Managed Postgres daily automated backups | Most data loss | ✅ Yes |
| Storage autoscaling (80% threshold) | Disk-full → read-only | ✅ Yes |
| Droplet backups | Server-level disaster | ✅ Daily, usage-based, 7-day retention (enabled 2026-09-15) — `docs/disaster-recovery.md` |
| Off-site nightly `pg_dump` to Spaces | DO account compromise, defense in depth | ⏳ To configure |
| Tested restore procedure | "We had backups but they don't work" | ✅ Practice restore 2026-09-15, every table matched — `docs/disaster-recovery.md` |
| Point-in-time recovery (PITR) | Accidental deletes, bad migrations | ✅ Already on the basic tier — any transaction in the last 7 days (checked 2026-09-15) |
| Off-site encrypted copy (Google Drive, every 2 h) | Losing DigitalOcean itself, or its 7-day backups | ✅ Since 2026-09-15 — `scripts/backup/`, alarm `backup-watch` |
| Automated standby node | Hardware failure / HA | ⏳ Upgrade DB tier at launch |

---

## 10. Pre-Launch Operational Checklist

To complete before any real production traffic:

### Infrastructure
- [ ] Move Spaces bucket + Droplet to `Sky Drop` project (currently in `first-project`)
- [ ] Verify weekly droplet backups appear in Backups & Snapshots tab
- [ ] Configure off-site `pg_dump` cron job to Spaces
- [ ] Test backup restore on a throwaway DB cluster
- [ ] Switch Postgres connection from public endpoint to VPC private endpoint
- [ ] Set up Sentry projects (frontend × 4, backend, workers)
- [ ] Configure DigitalOcean alerts (CPU, memory, disk, DB connections)
- [ ] Add a database standby node for failover (PITR already included — checked 2026-09-15)

### Application
- [ ] Separate staging environment (smaller droplet + DB)
- [ ] Database migrations run via Prisma in CI/CD, not manually
- [ ] PostGIS extension enabled if needed: `CREATE EXTENSION postgis;`
- [ ] TimescaleDB extension enabled: `CREATE EXTENSION timescaledb;`
- [ ] `tracking_events` table converted to hypertable
- [ ] All secrets in DigitalOcean Project env + 1Password backup (never in git)
- [ ] `.env` files verified in `.gitignore`

### Compliance / Business (for Phase 1B unlock)
- [ ] GST registration in India
- [ ] Import-Export Code (IEC)
- [ ] AD-Cat-I bank account opened
- [ ] CA engaged on retainer
- [ ] Bangladesh Bank consultation for BD seller side
- [ ] Cross-border payment partner selected (Wise/Payoneer/AD bank)

---

## 11. What's Next

Infrastructure is provisioned and hardened. Next:

1. ✅ Local dev environment setup (WSL2, Node, pnpm, Docker)
2. ✅ Repo cloned, `CLAUDE.md` + `.gitignore` + this file in place
3. ⏳ Monorepo skeleton (Turborepo + pnpm workspaces + `apps/*` + `packages/*`)
4. ⏳ Database schema design (Prisma) — Phase 1A entities
5. ⏳ Module-by-module build (auth → seller mgmt → SKU → WMS → orders → ...)

---

*This is the canonical source of truth for Skydrop's infrastructure. Update whenever resources change.*
