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

| Subdomain | Purpose | App in monorepo |
|---|---|---|
| `skydrop.online` | Public marketing site | `apps/marketing` |
| `app.skydrop.online` | Seller portal (BD merchants) | `apps/seller` |
| `admin.skydrop.online` | Staff portal (admin, call center, warehouse) | `apps/admin` |
| `track.skydrop.online` | Branded public tracking (Indian customers) | `apps/track` |
| `api.skydrop.online` | Backend API (consumed by all front-ends + B2B clients) | `apps/api` |

All five subdomains terminate at Cloudflare → forwarded to Caddy on the droplet → routed to the appropriate Node process on internal port.

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
| Droplet weekly backups | 20% of droplet cost | — | ~$6.40 |
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
| Phase 1B launch with paying sellers | Upgrade to Production-tier managed Postgres (adds PITR + standby) |

---

## 9. Data Protection Strategy

Layered approach — no single "dual database" replaces this:

| Layer | Protects against | Active? |
|---|---|---|
| Managed Postgres daily automated backups | Most data loss | ✅ Yes |
| Storage autoscaling (80% threshold) | Disk-full → read-only | ✅ Yes |
| Droplet weekly backups | Server-level disaster | ✅ Yes (~$6.40/mo) |
| Off-site nightly `pg_dump` to Spaces | DO account compromise, defense in depth | ⏳ To configure |
| Tested restore procedure | "We had backups but they don't work" | ⏳ Test before launch |
| Point-in-time recovery (PITR) | Accidental deletes, bad migrations | ⏳ Upgrade DB tier at launch |
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
- [ ] Upgrade to Production-tier Managed Postgres (adds PITR + standby)

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
