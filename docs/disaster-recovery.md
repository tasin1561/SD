# Disaster recovery

What is backed up, where, and how to get Skydrop back when something fails.
Written 2026-09-15. **Times marked "estimate" are replaced by measured times
after each practice restore** — see "Practice restores" at the end.

## What exists, and where the copies are

| What | Lives in | Copies |
|---|---|---|
| Database (`skydrop-db-prod`, PostgreSQL 18 + TimescaleDB 2.28, basic tier, primary only) | DigitalOcean, SGP1 | DigitalOcean daily backups, 7 days (automatic on managed databases). **Off-site: Google Drive every 6 hours.** No point-in-time recovery on the basic tier. |
| Stored files (`skydrop-prod-storage` Space: labels, invoices, top-up proofs, portal probes) | DigitalOcean Spaces, SGP1 | **Google Drive every 6 hours** (`files/current`, with anything overwritten or deleted kept in `files/changed/<run>` for 180 days). **Spaces object versioning ON since 2026-09-15**, with a lifecycle rule (`expire-old-versions-90d`) that removes a replaced or deleted object's old copy after 90 days — so a file overwritten or deleted by mistake can be brought back from the bucket itself within 90 days. |
| Main server `skydrop-app-prod` (API, admin, seller, track, reseller, portal worker, Caddy, Redis) | DigitalOcean droplet, SGP1 | Code: GitHub. Settings and secrets: **Google Drive every 6 hours**. DigitalOcean droplet backups: **off**. |
| India egress server `Skydrop-India-Socket` (Shiprocket panel tunnel) | DigitalOcean droplet, BLR1 | Its few settings ride in the same secrets bundle every 6 hours. |
| Redis (job queues) | the main server | Saved to disk (AOF). Not copied off-site: every job is re-created by the app or its cron. |

## The Google Drive copy

`scripts/backup/skydrop-backup.sh`, run from cron on the main server as
`skydrop` at 00:10, 06:10, 12:10 and 18:10 UTC. Each run:

1. dumps the database (`pg_dump` 18, custom format) and checks `pg_restore`
   can list it;
2. bundles the secrets and server settings (`.env`, Caddyfile, pm2 and
   tunnel units, the tunnel's SSH key, crontab) and the India server's
   settings;
3. mirrors the Space;
4. uploads everything through an rclone **crypt** remote — Google holds
   ciphertext only — and reads the database dump and the bundle back to
   compare them byte for byte;
5. prunes: everything from 7 days, then one per day for 30 days, one per
   week for 12 weeks, one per month for 24 months;
6. writes `system.backup.completed` or `system.backup.failed` into
   `audit_logs`.

**The alarm.** The API's `backup-watch` job reads those rows hourly and
raises a HIGH issue (`backup-failed`, `backup-stale`) when the latest run
failed or nothing has succeeded for 13 hours. Both clear themselves.

**The password.** `~/.config/skydrop-backup/passphrase` on the main server,
and with the owner OFF Google (password manager or paper). **Without it the
Drive copy cannot be opened.** It is six dot-separated groups (dots are not
in rclone's obscured alphabet), and it is set in the rclone config with
`rclone obscure` + `--no-obscure`, never as a plain `password=` value. Google's side is the `skydrop-backups` folder, reached through
**Skydrop's own Google app** (Cloud project `skydrop-508714`, published
*In production* — in *Testing* Google ends every sign-in after 7 days —
Desktop client, `drive.file` scope: it can reach only files it created).
Its client id and secret are needed only to reconnect the SERVER; the owner
keeps them with the password. A backup can always be opened without them
(below). Because of `drive.file`, a different app cannot see these files:
changing the app means starting a fresh folder, as on 2026-09-15 when the
backups moved off rclone's shared app (the earlier copy is
`skydrop-backups-rclone-app`).

Server paths: rclone config `~/.config/rclone/rclone.conf` (remotes
`skydrop-gdrive:` — Skydrop's own app — and the crypt `skydrop-backup:` over
it), log
`~/.local/state/skydrop-backup/backup.log`, a run by hand
`~/app/scripts/backup/skydrop-backup.sh`.

## Getting at a backup from anywhere

Needs only the backup password and the Google account — no server, no
Skydrop app, no Google Cloud client. The files rclone uploads are ordinary
files in that Drive, so:

1. On drive.google.com open `skydrop-backups` and download what you need,
   keeping the folder layout (`db/2026/09/defaultdb-<ts>.dump.bin`,
   `secrets/…`, `files/current/…`) — into a folder, say `./encrypted`.
2. On any computer with rclone (Windows, Mac or Linux):

```bash
# ALWAYS obscure the password yourself and pass --no-obscure. Handed a
# password that happens to look like rclone's obscured form, `config create`
# stores it as-is and it silently becomes a DIFFERENT key — that happened
# here on 2026-09-15 and is why the password was replaced.
rclone config create restore crypt remote=./encrypted \
  filename_encryption=off directory_name_encryption=false \
  password="$(rclone obscure '<the backup password>')" --no-obscure
rclone lsf -R restore:db | tail                  # the database dumps, decrypted names
rclone copy restore:db/2026/09/defaultdb-<ts>.dump .
rclone copy restore:secrets/2026/09/secrets-<ts>.tar.gz .
```

Proven on 2026-09-15: a dump downloaded raw from Drive and opened this way
was identical, byte for byte, to the one the server reads, and `pg_restore`
listed it.

## Scenarios

### A. The database is corrupted, or rows were deleted by mistake

Estimate: 30–60 min. Data lost: back to the chosen backup.

1. Put the apps in maintenance (stop the API: `pm2 stop skydrop-api`) so
   nothing writes to a database about to be replaced.
2. Either restore DigitalOcean's daily backup to a NEW cluster (panel →
   the database → Backups → Restore), or create a new PostgreSQL 18 cluster
   and restore the Drive dump into it:
   ```bash
   psql "$NEW_URL" -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;'
   psql "$NEW_URL" -c 'SELECT timescaledb_pre_restore();'
   pg_restore --no-owner --no-privileges --dbname="$NEW_URL" defaultdb-<ts>.dump
   psql "$NEW_URL" -c 'SELECT timescaledb_post_restore();'
   ```
3. Point `DATABASE_URL` in `~/app/.env` at the new cluster, add the main
   server to its trusted sources, `pm2 restart all`.
4. Check: `/health`, log in to admin, open the newest orders and the treasury.

### B. The main server is gone

Estimate: 2–4 h by hand today (about 15 min with DigitalOcean droplet
backups on). Data lost: none — the database and Space are separate.

1. New Ubuntu 24.04 droplet in SGP1, same VPC; attach the old reserved IP
   or update the Cloudflare A records.
2. Install Node 22, pnpm 11, Caddy, Docker (Redis), pm2 and the Postgres 18
   client as in `docs/infrastructure.md`.
3. Clone the repo to `~/app`, restore the secrets bundle
   (`tar -xzf secrets-<ts>.tar.gz -C /` puts `.env`, the Caddyfile, the
   systemd units and the SSH key back), `pnpm install`, build, `pm2 start
   ecosystem.config.cjs`, `pm2 save`, enable `pm2-skydrop`,
   `shiprocket-egress-tunnel` and `vpc-peering`.
4. Allow the new server in the database's trusted sources and restrict
   `ufw` to Cloudflare as in `docs/cloudflare-proxy.md`.
5. Re-install the backup: rclone, the passphrase file, the rclone config
   and the crontab line (all in the bundle).

### C. The India egress server is gone

Estimate: 20 min. Only the nightly Shiprocket panel reading stops meanwhile.

New Ubuntu 24.04 droplet in BLR1, restore its settings from
`india-egress.tar.gz` inside the secrets bundle (the authorized key is the
main server's tunnel key), `ufw allow OpenSSH && ufw enable`, update the
address in the tunnel unit and in `~/.config/skydrop-backup/india-host`.

### D. The whole DigitalOcean account is lost

Estimate: 4–6 h. Data lost: up to 6 hours. Scenario B at any provider, a
new PostgreSQL 18 with TimescaleDB 2.28 restored as in A, a new
S3-compatible bucket filled from `files/current`, and the storage keys in
`.env` changed to it.

## Practice restores

Each practice restore downloads the newest Drive dump, restores it into a
throwaway TimescaleDB container on the main server, compares row counts
with production, and deletes it. Record the measured times here.

| Date | Dump age | Download | Restore | Counts match | Notes |
|---|---|---|---|---|---|
| 2026-09-15 | 2 min | — (dump taken on the server, before Drive was connected) | dump 2.7 s (4.1 MB, 1,787 entries); empty TimescaleDB 2.28.2 / PG 18.4 container ready 5.8 s; `pg_restore` 4.2 s, 0 errors | 18 of 18 tables identical to production (orders 50, wallet entries 52 + 14, bank entries 86, courier transactions 31,463, audit rows 5,722…); both hypertables; QA seller balance ₹759.94 = production | The `timescale/timescaledb` image already has the extension, so `CREATE EXTENSION` reports it exists — harmless. pg_dump's "circular foreign-key constraints" warning on the Timescale catalog is expected; `timescaledb_pre_restore()` handles it. |
