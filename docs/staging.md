# Staging

A parallel Skydrop on the same droplet, for testing the *deployed*
system without any of production's consequences.

**Status:** running. Waiting on four DNS records (see below) before the
browser can reach it.

---

## Why it exists

Testing on production has four problems, and one of them cannot be
undone.

**GST invoice numbers.** An order reaching DELIVERED generates a real
tax invoice numbered from a per-fiscal-year Postgres sequence.
`nextval()` is not transactional — deleting the invoice row afterwards
does not give the number back. Test orders would leave permanent gaps,
or test entries, in a legally significant series.

**Real emails.** Production holds a live Resend key. Every confirmation,
dispatch and delivery notification actually sends, to whatever address
was typed in.

**Delhivery writes are blocked, so the courier half cannot be tested
there anyway.** `courier.delhivery_live_writes_enabled` is false and
gates all nine write paths including AWB creation. Turning it on points
at the real Delhivery with the real token and creates real consignments.

**Financial rows are never deleted, by design.** Wallet entries,
invoices and GST withholdings from test orders would sit in the reports
for good, and the order-number sequence advances with them.

Staging has none of those properties.

---

## What it is

| | Production | Staging |
|---|---|---|
| Database | DO managed cluster | **Docker Postgres on the droplet**, port 5433 |
| Redis | droplet, :6379 | droplet, **:6380** |
| API | :4000 | **:4100** |
| admin / seller / track | 3002 / 3003 / 3004 | **3102 / 3103 / 3104** |
| Email | live Resend key | **`RESEND_API_KEY=` empty** — logged, never sent |
| Uploads | real Spaces bucket | **`DEV_MOCK_SPACES=true`** |
| Delhivery | real API, writes blocked | **simulator on :4110**, writes ON |
| Secrets | production keys | **generated fresh** — a staging JWT is not valid on production |

The database is Docker rather than a second database on the managed
cluster for two reasons: production has 25 connections and about 8 to
spare, so a staging run must not be able to exhaust them; and throwing
staging away should be `docker compose down -v`, not a careful DELETE
against rows that matter.

---

## The one thing left to do

Four DNS A-records, all pointing at **68.183.190.55**:

```
stg-api.skydrop.online
stg-admin.skydrop.online
stg-app.skydrop.online
stg-track.skydrop.online
```

Caddy is already configured for them and will fetch certificates
automatically once they resolve. Until then staging is reachable only
from the droplet itself.

---

## Using it

Logins, once DNS resolves:

```
stg-admin.skydrop.online   admin@test.local  / Test-Admin-1234
stg-app.skydrop.online     seller@test.local / Test-Seller-1234
```

Three SKUs are stocked at 50 each: `BLUE-T-SHIRT`, `PHONE-CASE`,
`WATER-BOTTLE`.

**Nothing you do in the app makes a parcel move.** The courier does
that, and on staging the courier is a simulator you drive by hand from
the droplet:

```bash
ssh skydrop
curl -s localhost:4110/_sim/parcels | jq            # every parcel and its AWB

curl -s -XPOST localhost:4110/_sim/parcels/<AWB>/advance \
  -H 'content-type: application/json' -d '{"stage":"IN_TRANSIT"}'
```

Stages: `IN_TRANSIT` → `OUT_FOR_DELIVERY` → `DELIVERED`. For a return,
`NDR` → `RTO_INITIATED` → `RTO_IN_TRANSIT`, then receive it in the
warehouse screens — a webhook is deliberately not allowed to declare
`RTO_RECEIVED` (TRK-6), because that starts the conservation-critical
finalize chain and somebody has to physically have the carton.

Scans before dispatch are recorded on the timeline and correctly ignored
(TRK-4): a parcel nobody picked has not earned "in transit".

### Scripted check

```bash
ssh skydrop
cd /home/skydrop/staging/app
export DATABASE_URL='postgresql://skydrop:staging-only-not-a-secret@127.0.0.1:5433/skydrop_staging'
export SKYDROP_API_URL=http://127.0.0.1:4100 SIM_URL=http://127.0.0.1:4110
cd apps/delhivery-sim && ./node_modules/.bin/tsx ../../scripts/sim-e2e.ts
```

Drives two parcels — one delivered, one refused and returned and
restocked — and asserts stock conservation on each. Worth running before
blaming your own clicking.

---

## Operating it

Deploy the current main:

```bash
ssh skydrop
cd /home/skydrop/staging/app && git fetch origin main && git reset --hard origin/main
pnpm install --frozen-lockfile
pnpm --filter @skydrop/db build && pnpm --filter @skydrop/db exec prisma migrate deploy
pnpm --filter @skydrop/api-client build && pnpm --filter @skydrop/ui build
pnpm --filter @skydrop/api build
API_ORIGIN=http://127.0.0.1:4100 pnpm --filter ./apps/admin build
API_ORIGIN=http://127.0.0.1:4100 pnpm --filter ./apps/seller build
pm2 restart skydrop-api-staging skydrop-admin-staging skydrop-seller-staging skydrop-track-staging
```

Reset the data completely:

```bash
cd /home/skydrop/staging && docker compose down -v && docker compose up -d
# then migrate + seed + dev-accounts again
```

Take it down entirely:

```bash
pm2 delete skydrop-api-staging skydrop-admin-staging skydrop-seller-staging \
           skydrop-track-staging skydrop-delhivery-sim && pm2 save
cd /home/skydrop/staging && docker compose down -v
```

`ecosystem.config.cjs` serves both environments — `SKYDROP_ENV_SUFFIX`
and `SKYDROP_PORT_OFFSET` are what make the staging stack distinct.
Unset, it is production exactly as before.

---

## Where staging differs from production, on purpose

Worth knowing before you trust a staging result:

- **TimescaleDB compression is ON in staging and impossible in
  production.** The Docker image ships the Community licence;
  DigitalOcean's managed Postgres is Apache-licensed, where compression
  does not exist. Staging will not reproduce production's storage
  growth.
- **The courier is a simulator**, which encodes *our* belief about
  Delhivery's wire format. Where that belief is wrong the simulator is
  wrong in the same direction and agrees with us.
  `docs/delhivery-go-live-test.md` remains the only thing that settles
  it.
- **Mail is never sent**, so anything that depends on a human receiving
  an email — invitation links, password resets — has to be read out of
  the API log rather than an inbox.
