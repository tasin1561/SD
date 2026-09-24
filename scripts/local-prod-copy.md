# Local pre-production check with real data

Restore a copy of production into a LOCAL database and run the API plus all
four apps (admin, seller, track, reseller) against it, with nothing able to
reach anything outside this machine. Use it to look at the restyled screens
with real volumes and real edge cases before a stage goes live, and to prove
the money figures are the same strings production shows.

The helper is `scripts/local-prod-copy.sh`. It refuses every subcommand
(exit 2, `REFUSED: …`) unless the database, Redis and the API origin are all
on this machine, the database is the copy (`skydrop_prodcopy`) and
`NODE_ENV` is not `production`. The addresses can be overridden only through
`PRODCOPY_DATABASE_URL` / `PRODCOPY_REDIS_URL` / `PRODCOPY_API_ORIGIN`, so a
wrong one is refused rather than silently replaced. The shell's own
`DATABASE_URL`/`REDIS_URL` are ignored on purpose.

**The dump holds real customer names, phones and addresses.** Keep it in
`~/.skydrop-prodcopy/` (outside the repo, `chmod 700`). Never commit it,
never share a screenshot of the copy that shows a customer, and delete it
when you are done (`drop`, plus the file).

---

## 1. Take the dump on the droplet (read-only; you run this)

`pg_dump` only reads. It works from one consistent snapshot and takes the
same share locks a `SELECT` does, so production keeps serving while it runs.
These are the flags the hourly backup already uses
(`scripts/backup/skydrop-backup.sh`).

```bash
ssh skydrop
umask 077
URL="$(grep '^DATABASE_URL=' ~/app/.env | cut -d= -f2- | tr -d '"'"'"'')"
URL="${URL%%\?*}?sslmode=require"          # Prisma's own parameters are not libpq's
PG=/usr/lib/postgresql/18/bin

# The TimescaleDB version: the copy's container must match it exactly.
$PG/psql "$URL" -Atc "select extversion from pg_extension where extname='timescaledb'; show server_version;"

$PG/pg_dump --format=custom --compress=6 --no-owner --no-privileges \
  --dbname="$URL" --file=~/prodcopy-$(date +%F).dump
$PG/pg_restore --list ~/prodcopy-$(date +%F).dump >/dev/null && echo "dump OK"
exit
```

Copy it down, then remove it from the droplet:

```bash
mkdir -p ~/.skydrop-prodcopy && chmod 700 ~/.skydrop-prodcopy
scp skydrop:~/prodcopy-$(date +%F).dump ~/.skydrop-prodcopy/
ssh skydrop 'rm -f ~/prodcopy-*.dump'
```

(Alternative: the hourly off-site backup in Drive is the same format; see
`docs/disaster-recovery.md` for decrypting one. The steps below are the same
from there on.)

## 2. Restore it locally

```bash
# If step 1 printed a TimescaleDB version other than 2.28.2, name the matching image:
#   TS_IMAGE=timescale/timescaledb:<version>-pg18 scripts/local-prod-copy.sh restore …
scripts/local-prod-copy.sh restore ~/.skydrop-prodcopy/prodcopy-<date>.dump
```

What it does:
- Starts its **own** container, `skydrop-prodcopy`, on `127.0.0.1:5433`, apart from the dev database on 5432.
- Creates a fresh `skydrop_prodcopy` database.
- Restores the dump between `timescaledb_pre_restore()` and `timescaledb_post_restore()`.
- Prints the TimescaleDB version it ended on.
- Runs `neutralise` (below).

A warning about circular foreign keys on the Timescale catalog is expected.
Any other `pg_restore: error` is not, so read it before trusting the copy.
**A version mismatch fails loudly** (`catalog version mismatch, expected
"2.28.2" seen "2.27.0"`). That is the rule working: run `drop`, then restore
again with the matching `TS_IMAGE`.

**`neutralise`** writes only to the copy, and can be re-run on its own:
- every `courier.*_api_base_url` (and `chat.chatwoot_base_url`) set to empty;
- every courier write, pickup, sync, invoice-check and automation switch off;
- NSA off;
- `courier_channel_settings` set to portal **off**, write mode **manual**;
- every seller webhook endpoint inactive.

It then prints the courier base URLs and live-write switches so you can see
they are empty and false.

## 3. Start everything against the copy

Build first if the working tree has changed since the last build:

```bash
pnpm --filter @skydrop/ui build
pnpm --filter @skydrop/api build
for a in admin seller track reseller; do pnpm --filter @skydrop/$a build; done
scripts/local-prod-copy.sh start      # stop with: scripts/local-prod-copy.sh stop
```

`start` refuses if any of ports 4000, 3002 to 3005 is busy (stop your dev
servers first). It prints the API's effective environment before starting:

| Guardrail | Setting |
|---|---|
| Database | `127.0.0.1:5433/skydrop_prodcopy` (checked, not assumed) |
| Redis | `redis://127.0.0.1:6379/5`, its own logical DB (dev uses 0, e2e 1) |
| Queues and crons | `WORKERS_ENABLED=false`, `PORTAL_WORKERS_ENABLED=false`: no BullMQ worker runs, so no email, webhook, courier call, sync, sweep or payout job is ever processed |
| Email | `RESEND_API_KEY` empty, so the API logs `[DEV] Would send email` |
| Couriers | base URLs empty (neutralise) and `COURIER_CREDENTIALS_KEY_V1` empty, so no stored courier credential can even be decrypted |
| Storage | `DEV_MOCK_SPACES=true`, Spaces keys empty (product images, labels and invoices will not load; that is expected) |
| SMS, WhatsApp, push, payouts | none of these exists as an outbound integration in this codebase |

Then:
- admin http://localhost:3002
- seller http://localhost:3003
- track http://localhost:3004
- reseller http://localhost:3005

Logs are in `~/.skydrop-prodcopy/*.log`.

## 4. Signing in

- **Your real passwords work.** The dump carries every account's argon2 hash
  as it is in production. Sessions do not carry over: the local API signs
  with the local JWT key, so you sign in afresh. Login throttling uses the
  local Redis.
- **Or set a local password** for one seller and one admin. This writes to
  the copy only, and production is never touched:

  ```bash
  scripts/local-prod-copy.sh set-password staff  qa-bot@skydrop.online
  scripts/local-prod-copy.sh set-password seller qa-seller@skydrop.online
  scripts/local-prod-copy.sh set-password store  <a store login>
  ```

  It prompts for the password without echoing it (or reads one line from
  stdin). It needs at least 10 characters, hashes with the same argon2id
  parameters the API uses, and refuses if no live account has that email.
  The password never appears on a command line.

## 5. What to compare against production

Open the same screen on production (as the same account) and on the copy.
The strings must match exactly: the same `₹`/`৳` grouping, the same paisa,
the same sign. The copy is a snapshot from the moment of the dump, so use
records that have not moved since (the QA accounts, a closed month, a
delivered order, a completed consignment), or compare against a production
screenshot taken right after the dump.

1. **A seller's wallet.** Seller app → `/wallet` as `qa-seller`:
   - the INR balance;
   - the BDT balance, if the seller shows taka, with its `₹1 = ৳…` rate;
   - the first ten ledger rows: label, amount, running balance.

   On admin, `/seller-wallets/<that seller>` must show the same balance and
   the same rows.
2. **Admin treasury totals.** Admin → `/treasury`:
   - owed to sellers;
   - held for sellers;
   - surplus or shortfall;
   - courier wallets;
   - each per-currency total.

   Then `/liabilities`: we owe, owed to us, net. All are summed from the
   ledgers on every read, so a mismatch is a rendering difference, never a
   stale cache.
3. **One order's charges band.** Pick a DELIVERED order. Admin → `/orders/<id>` → Charges:
   - each line (base shipping, GST at its rate, any fee): label and amount;
   - the total;
   - the visibility column.

   Seller → `/orders/<id>`: the same lines, restricted to seller-visible
   ones, and the same total.
4. **One consignment's counts.** Pick one that has been received. Admin →
   `/warehouse/consignments/<id>`, and seller → `/inbound/<id>`:
   - per line: declared, counted and difference, for each leg (Dhaka intake,
     India arrival);
   - units in transit;
   - the freight bill amount, if billed.

If the copy and production disagree on any of these, the restyle is not
the only suspect. First check the record did not move after the dump
(compare against a screenshot taken at dump time).

## 6. Clean up

```bash
scripts/local-prod-copy.sh stop
scripts/local-prod-copy.sh drop               # container + volume
rm -f ~/.skydrop-prodcopy/prodcopy-*.dump
```

Tested locally on 2026-09-24:
- Guard refusals: a remote host, the dev database, a remote Redis, a remote
  API origin, and `NODE_ENV=production`.
- A restore of the dev database's dump. With the matching image (2.27) it
  worked end to end, including `neutralise`. With 2.28 it was refused with
  the version-mismatch error above.
- `set-password`, `start` and `stop`.

Not tested: a production dump. That is yours to take.
