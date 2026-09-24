#!/usr/bin/env bash
# Local pre-production check against a COPY of production data.
# See scripts/local-prod-copy.md for the whole procedure.
#
# DEV-ONLY. Every subcommand refuses to run unless the database, Redis and
# the API it talks to are on this machine, and the database is the copy
# (skydrop_prodcopy) — never the dev database, never production.
#
#   scripts/local-prod-copy.sh restore <dump-file>   # container + restore + neutralise
#   scripts/local-prod-copy.sh neutralise            # re-run the safety updates
#   scripts/local-prod-copy.sh set-password staff|seller|store <email>   # reads the password from stdin
#   scripts/local-prod-copy.sh start                 # API + admin/seller/track/reseller
#   scripts/local-prod-copy.sh stop                  # stops what start started (by port)
#   scripts/local-prod-copy.sh drop                  # deletes the copy (container + volume)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="${SKYDROP_PRODCOPY_RUN:-$HOME/.skydrop-prodcopy}"   # logs + pids, outside the repo
mkdir -p "$RUN"

# ── The copy's own Postgres: separate container, separate port ─────────
# Production runs TimescaleDB 2.28 on PG 18; restoring a dump needs the SAME
# extension version (the dev container's image stops at 2.27). Override
# TS_IMAGE if the version recorded in step 1 of the .md differs.
TS_IMAGE="${TS_IMAGE:-timescale/timescaledb:2.28.2-pg18}"
CONTAINER="skydrop-prodcopy"
PG_PORT=5433
DB_NAME="skydrop_prodcopy"

# Overridable (PRODCOPY_*) so a wrong value is REFUSED by the guard below
# rather than silently replaced. The shell's own DATABASE_URL/REDIS_URL are
# deliberately ignored: a dev shell commonly has them set to something else.
export DATABASE_URL="${PRODCOPY_DATABASE_URL:-postgresql://skydrop:skydrop@127.0.0.1:${PG_PORT}/${DB_NAME}}"
export REDIS_URL="${PRODCOPY_REDIS_URL:-redis://127.0.0.1:6379/5}"   # own logical DB; dev uses 0, e2e 1
export API_ORIGIN="${PRODCOPY_API_ORIGIN:-http://127.0.0.1:4000}"

DOCKER="${DOCKER:-}"
if [ -z "$DOCKER" ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then DOCKER=docker
  else DOCKER="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"; fi
fi
dk() { "$DOCKER" "$@"; }

die() { echo "local-prod-copy: $*" >&2; exit 1; }

# ── The guard. Runs before EVERY subcommand. ─────────────────────────
host_of() { sed -E 's#^[a-z+]+://([^@/]*@)?\[?([^]:/?]+)\]?.*#\2#' <<<"$1"; }
dbname_of() { sed -E 's#^[a-z+]+://[^/]*/([^?]*).*#\1#' <<<"$1"; }
is_local() { case "$1" in 127.0.0.1|localhost|::1) return 0 ;; *) return 1 ;; esac; }
guard() {
  local refusals=()
  is_local "$(host_of "$DATABASE_URL")" || refusals+=("DATABASE_URL is not localhost")
  [ "$(dbname_of "$DATABASE_URL")" = "$DB_NAME" ] || refusals+=("DATABASE_URL is not the ${DB_NAME} copy")
  is_local "$(host_of "$REDIS_URL")" || refusals+=("REDIS_URL is not localhost")
  is_local "$(host_of "$API_ORIGIN")" || refusals+=("API_ORIGIN is not localhost")
  [ "${NODE_ENV:-}" != "production" ] || refusals+=("NODE_ENV is production")
  if [ ${#refusals[@]} -gt 0 ]; then
    printf 'REFUSED: %s\n' "${refusals[@]}" >&2
    exit 2
  fi
}
guard

psql_copy() { dk exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U skydrop -d "$DB_NAME" "$@"; }

# ── neutralise: nothing in the copy can reach anything outside ───────
# Belt and braces: the API also runs with workers OFF, no email key, no
# courier credential key and mocked storage (see `start`). These updates
# make the DATA agree, so the copy stays safe even if someone later starts
# it with workers on.
neutralise() {
  psql_copy <<'SQL'
BEGIN;
-- Couriers point at nothing, and every write/automation switch is off.
UPDATE system_settings SET value_string = ''
  WHERE key LIKE 'courier.%_api_base_url' OR key = 'chat.chatwoot_base_url';
UPDATE system_settings SET value_boolean = false
  WHERE value_boolean IS NOT NULL AND (
        key LIKE 'courier.%_live_writes_enabled'
     OR key LIKE 'courier.%_auto_pickup_enabled'
     OR key LIKE 'courier.%_sync_enabled'
     OR key LIKE 'courier.%_sync_writes_enabled'
     OR key LIKE 'courier.%_invoice_check_enabled'
     OR key IN ('courier.delhivery_waybill_pool_refill_enabled', 'courier.ndr_runner_enabled',
                'courier.ticket_automation_enabled', 'courier.tracking_poll_auto_recover_enabled',
                'ops.nsa_enabled'));
-- The portal browser never opens; the escalation channel waits for a person.
UPDATE courier_channel_settings SET portal_mode = 'off', write_mode = 'manual';
-- No outbound webhook to a seller's server.
UPDATE seller_webhook_endpoints SET is_active = false WHERE is_active;
COMMIT;
SELECT key, coalesce(value_string, value_boolean::text) AS now
  FROM system_settings
 WHERE key LIKE 'courier.%_api_base_url' OR key LIKE 'courier.%_live_writes_enabled'
 ORDER BY key;
SQL
  echo "neutralised."
}

restore() {
  local dump="${1:-}"
  [ -f "$dump" ] || die "restore needs a dump file (got '${dump}')"
  if ! dk ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "── starting ${CONTAINER} (${TS_IMAGE}) on 127.0.0.1:${PG_PORT}"
    dk run -d --name "$CONTAINER" -e POSTGRES_USER=skydrop -e POSTGRES_PASSWORD=skydrop \
      -e POSTGRES_DB=postgres -p "127.0.0.1:${PG_PORT}:5432" -v skydrop_prodcopy_data:/var/lib/postgresql \
      "$TS_IMAGE" >/dev/null
  else
    dk start "$CONTAINER" >/dev/null
  fi
  # -h 127.0.0.1: on first start the init server listens on the socket only
  # and then restarts; only the FINAL server answers on TCP.
  for _ in $(seq 1 60); do dk exec "$CONTAINER" pg_isready -h 127.0.0.1 -U skydrop >/dev/null 2>&1 && break; sleep 1; done

  echo "── fresh ${DB_NAME}"
  dk exec "$CONTAINER" psql -v ON_ERROR_STOP=1 -U skydrop -d postgres \
    -c "DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)" -c "CREATE DATABASE ${DB_NAME}"
  psql_copy -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()"

  echo "── pg_restore (a warning about circular foreign keys on the Timescale catalog is expected)"
  dk cp "$dump" "${CONTAINER}:/tmp/prod.dump"
  dk exec "$CONTAINER" pg_restore -U skydrop -d "$DB_NAME" --no-owner --no-privileges /tmp/prod.dump \
    || echo "   pg_restore reported errors above — read them before trusting the copy"
  dk exec "$CONTAINER" rm -f /tmp/prod.dump
  psql_copy -c "SELECT timescaledb_post_restore()"
  psql_copy -Atc "SELECT 'timescaledb ' || extversion FROM pg_extension WHERE extname = 'timescaledb'"

  neutralise
  echo "restored. The dump file is still at ${dump} — delete it when you are done (it holds customer data)."
}

set_password() {
  local kind="${1:-}" email="${2:-}" table
  case "$kind" in staff) table=staff_users ;; seller) table=seller_users ;; store) table=store_users ;;
    *) die "set-password staff|seller|store <email>" ;; esac
  [ -n "$email" ] || die "set-password needs an email"
  local pw
  if [ -t 0 ]; then read -r -s -p "New LOCAL password for ${email}: " pw; echo; else read -r pw; fi
  [ ${#pw} -ge 10 ] || die "use at least 10 characters"
  # The same argon2id parameters the API uses. Hashed here, written ONLY to
  # the local copy; the password never appears on a command line.
  local hash
  hash="$(cd "$ROOT/apps/api" && PW="$pw" node --input-type=module -e "
    import argon2 from 'argon2';
    process.stdout.write(await argon2.hash(process.env.PW, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }));")"
  local n
  n="$(psql_copy -qAt -v h="$hash" -v e="$email" <<SQL
UPDATE ${table} SET password_hash = :'h' WHERE lower(email) = lower(:'e') AND deleted_at IS NULL RETURNING id;
SQL
)"
  [ -n "$n" ] || die "no live ${kind} user with that email in the copy"
  echo "local password set for ${kind} ${email} (in ${DB_NAME} only)."
}

# No listener is a normal answer, not a failure (set -e + pipefail).
port_pid() { { ss -ltnp 2>/dev/null | grep ":$1 " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2; } || true; }

start() {
  for p in 4000 3002 3003 3004 3005; do
    [ -z "$(port_pid "$p")" ] || die "port $p is already in use — run stop (or stop your dev servers) first"
  done
  [ -f "$ROOT/apps/api/dist/main.js" ] || die "build first: pnpm --filter @skydrop/api build"
  for a in admin seller track reseller; do
    [ -d "$ROOT/apps/$a/.next" ] || die "build first: pnpm --filter @skydrop/$a build"
  done

  # The API's environment: the dev .env for non-secret defaults, then every
  # override that keeps the copy inside this machine. Printed back so it can
  # be checked.
  local copy_db="$DATABASE_URL" copy_redis="$REDIS_URL"
  (
    set -a; . "$ROOT/apps/api/.env"; set +a
    # The dev .env names the DEV database and Redis; the copy's win.
    export DATABASE_URL="$copy_db" REDIS_URL="$copy_redis"
    export NODE_ENV=development PORT=4000 BIND_HOST=127.0.0.1
    export WORKERS_ENABLED=false PORTAL_WORKERS_ENABLED=false   # no queue is ever processed
    export RESEND_API_KEY=''                                     # email: "[DEV] Would send email"
    export COURIER_CREDENTIALS_KEY_V1=''                         # no courier credential can be decrypted
    export DEV_MOCK_SPACES=true SPACES_ACCESS_KEY_ID='' SPACES_SECRET_ACCESS_KEY=''
    guard
    echo "API env: DATABASE_URL→$(host_of "$DATABASE_URL")/$(dbname_of "$DATABASE_URL")  REDIS_URL→${REDIS_URL}  WORKERS_ENABLED=${WORKERS_ENABLED}  RESEND_API_KEY=${RESEND_API_KEY:-<empty>}  COURIER_CREDENTIALS_KEY_V1=${COURIER_CREDENTIALS_KEY_V1:-<empty>}  DEV_MOCK_SPACES=${DEV_MOCK_SPACES}"
    cd "$ROOT/apps/api" && nohup node dist/main.js </dev/null >"$RUN/api.log" 2>&1 &
  )
  for _ in $(seq 1 60); do [ -n "$(port_pid 4000)" ] && break; sleep 1; done
  [ -n "$(port_pid 4000)" ] || die "the API did not come up — see $RUN/api.log"

  local a p
  for pair in admin:3002 seller:3003 track:3004 reseller:3005; do
    a="${pair%%:*}"; p="${pair##*:}"
    ( cd "$ROOT/apps/$a" && API_ORIGIN="$API_ORIGIN" NODE_ENV=production \
        nohup ./node_modules/.bin/next start -p "$p" -H localhost </dev/null >"$RUN/$a.log" 2>&1 & )
  done
  for p in 3002 3003 3004 3005; do
    for _ in $(seq 1 40); do [ -n "$(port_pid "$p")" ] && break; sleep 1; done
  done
  echo "admin    http://localhost:3002"
  echo "seller   http://localhost:3003"
  echo "track    http://localhost:3004"
  echo "reseller http://localhost:3005"
  echo "logs     $RUN/*.log"
}

stop() {
  local pid
  for p in 3002 3003 3004 3005 4000; do
    pid="$(port_pid "$p")"
    if [ -n "$pid" ]; then kill "$pid" && echo "stopped :$p"; fi
  done
  true
}

drop() {
  stop
  dk rm -f "$CONTAINER" >/dev/null 2>&1 || true
  dk volume rm skydrop_prodcopy_data >/dev/null 2>&1 || true
  echo "copy deleted (container and volume). Delete the dump file too."
}

case "${1:-}" in
  restore) shift; restore "$@" ;;
  neutralise) neutralise ;;
  set-password) shift; set_password "$@" ;;
  start) start ;;
  stop) stop ;;
  drop) drop ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
