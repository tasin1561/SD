#!/usr/bin/env bash
#
# Bring a FILMING STACK up, drive a command inside one, or look at one.
#
#   scripts/tutorials/stack.sh up b          # database, migrations, seed, processes
#   scripts/tutorials/stack.sh status b
#   scripts/tutorials/stack.sh restart b admin
#   scripts/tutorials/stack.sh down b
#   scripts/tutorials/stack.sh env b         # eval "$(… env b)"
#   scripts/tutorials/stack.sh run b -- node scripts/tutorials/record.mjs --check pack-a-parcel
#
# WHY A STACK AT ALL. `seed-demo-data.mjs` rebuilds the demo world before
# EVERY take, so two agents filming against one database reseed under
# each other mid-scene. A stack is every piece of state a take touches —
# a Postgres database, a Redis logical DB, four ports and an
# object-storage bucket — and `lib/stacks.mjs` is the one table that says
# which belongs to whom. Read that file before changing anything here.
#
# WHAT IS SHARED, DELIBERATELY: the Postgres SERVER, the Redis SERVER,
# the compiled builds in apps/*/dist and apps/*/.next (read-only at run
# time), and `out/audio` (narration is keyed on the slug, so sharing it
# is what stops the same sentence being bought twice from ElevenLabs).
#
# WHAT MUST NEVER BE SHARED: the database, the Redis DB index, any port,
# and the bucket. Each has its own line in `lib/stacks.mjs` for that
# reason, and `assertStackEnvironment` refuses a run whose ambient
# environment is some other stack's.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
STACKS_JS="$ROOT/scripts/tutorials/lib/stacks.mjs"

usage() {
  sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

CMD="${1:-}"
NAME="${2:-}"
[ -n "$CMD" ] || usage
[ -n "$NAME" ] || usage

# Resolve the stack FIRST, so a typo in the name is one line of output
# rather than a half-built database called `skydrop_tut_bb`.
STACK_JSON="$(node "$STACKS_JS" --json "$NAME")"
jq_of() { node -e 'const s=JSON.parse(process.argv[1]);const p=process.argv[2].split(".");let v=s;for(const k of p)v=v[k];process.stdout.write(String(v));' "$STACK_JSON" "$1"; }

STACK_NAME="$(jq_of name)"
DB_NAME="$(jq_of database)"
REDIS_DB="$(jq_of redisDb)"
API_PORT="$(jq_of api.port)"
SELLER_PORT="$(jq_of seller.port)"
ADMIN_PORT="$(jq_of admin.port)"
RESELLER_PORT="$(jq_of reseller.port)"
ASSOCIATE_PORT="$(jq_of associate.port)"
SIM_PORT="$(jq_of sim.port)"
API_URL="$(jq_of api.url)"
SELLER_URL="$(jq_of seller.url)"
ADMIN_URL="$(jq_of admin.url)"
RESELLER_URL="$(jq_of reseller.url)"
ASSOCIATE_URL="$(jq_of associate.url)"
SIM_URL_V="$(jq_of sim.url)"

RUN_DIR="$ROOT/scripts/tutorials/out/stack-$STACK_NAME"
PG_CONTAINER="${TUT_PG_CONTAINER:-skydrop-postgres}"

# SECRETS FROM `apps/api/.env` FIRST, THEN THE STACK ON TOP — and the
# order is the whole point. That file hard-sets DATABASE_URL to stack A's
# database and REDIS_URL to logical DB 0, so applying it afterwards would
# silently point stack B's processes at stack A's world. Everything the
# stacks table owns is re-exported below; everything else (the JWT key,
# the courier encryption key, the webhook secret, DEV_MOCK_SPACES) is
# shared on purpose, because a filming stack is not a second deployment.
load_stack_env() {
  if [ -f "$ROOT/apps/api/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT/apps/api/.env"
    set +a
  fi
  eval "$(node "$STACKS_JS" --env "$STACK_NAME")"
}

up() {
  curl -fsS -o /dev/null --max-time 3 "$1" 2>/dev/null
}

say() { printf '  %s\n' "$*"; }

# ── env / run ───────────────────────────────────────────────────────────

case "$CMD" in
  env)
    # The STACK's half only. `apps/api/.env`'s secrets are deliberately
    # not printed — `eval`ing a block with a JWT key in it puts the key
    # in the caller's shell history, and every path that needs those
    # sources that file itself.
    node "$STACKS_JS" --env "$STACK_NAME"
    exit 0
    ;;
  run)
    shift 2
    [ "${1:-}" = "--" ] && shift
    [ $# -gt 0 ] || { echo "stack.sh run <name> -- <command…>"; exit 1; }
    load_stack_env
    exec "$@"
    ;;
esac

# ── status ──────────────────────────────────────────────────────────────

# Is this Next server still serving the build that is on disk?
#
# `apps/*/.next` is SHARED between stacks and is read-only at RUN time —
# but it is not read-only while somebody BUILDS. A rebuild replaces every
# hashed chunk, and a `next start` that was already running keeps
# emitting HTML naming the chunks it booted with. The browser then gets a
# 400 for `webpack-<old hash>.js`, the page never hydrates, and the form
# on it does nothing at all: sign-in submits nothing and the failure
# arrives as `page.waitForURL` timing out, which reads exactly like a
# moved selector. It cost two check runs on 2026-10-01, on a stack whose
# four processes were all answering and all healthy.
#
# The honest question is not "which build id" — the App Router puts none
# in the HTML — but "does the chunk this page just asked for still
# exist", which is the failure itself rather than a proxy for it.
fresh_build() {
  local base="$1" chunk
  chunk="$(curl -fsS --max-time 5 "$base/login" 2>/dev/null \
    | grep -oE '/_next/static/chunks/[A-Za-z0-9._-]+\.js' | head -1)" || return 0
  [ -n "$chunk" ] || return 0
  curl -fsS -o /dev/null --max-time 5 "$base$chunk" 2>/dev/null
}

status() {
  echo "Filming stack \"$STACK_NAME\""
  echo "  database   $DB_NAME"
  echo "  redis DB   $REDIS_DB"
  local ok=0
  for pair in "api:$API_URL/health" "seller:$SELLER_URL/login" "admin:$ADMIN_URL/login" "reseller:$RESELLER_URL/login" "associate:$ASSOCIATE_URL/login" "sim:$SIM_URL_V/_sim/parcels"; do
    local what="${pair%%:*}" url="${pair#*:}"
    if up "$url"; then
      case "$what" in
        seller | admin)
          local base="$SELLER_URL"
          [ "$what" = admin ] && base="$ADMIN_URL"
          [ "$what" = reseller ] && base="$RESELLER_URL"
          [ "$what" = associate ] && base="$ASSOCIATE_URL"
          if fresh_build "$base"; then
            printf '  %-9s UP    %s\n' "$what" "$url"
          else
            printf '  %-9s STALE %s  — serving a build that has been replaced; restart it:\n' \
              "$what" "$url"
            printf '            scripts/tutorials/stack.sh restart %s %s\n' "$STACK_NAME" "$what"
            ok=1
          fi
          ;;
        *) printf '  %-9s UP    %s\n' "$what" "$url" ;;
      esac
    else
      printf '  %-9s down  %s\n' "$what" "$url"
      ok=1
    fi
  done
  return $ok
}

# ── up ─────────────────────────────────────────────────────────────────

ensure_database() {
  docker exec "$PG_CONTAINER" pg_isready -U skydrop -d postgres >/dev/null 2>&1 || {
    echo "Postgres container \"$PG_CONTAINER\" is not ready — run: pnpm db:up"
    exit 1
  }
  if docker exec -e PGPASSWORD=skydrop "$PG_CONTAINER" \
      psql -U skydrop -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
    say "database $DB_NAME exists"
  else
    docker exec -e PGPASSWORD=skydrop "$PG_CONTAINER" \
      psql -U skydrop -d postgres -c "CREATE DATABASE $DB_NAME" >/dev/null
    say "database $DB_NAME created"
  fi
  # TimescaleDB is per-DATABASE and `docker/init/01-extensions.sql` runs
  # only against POSTGRES_DB on first container init, so a new database
  # has no extension. The init migration does `CREATE EXTENSION IF NOT
  # EXISTS timescaledb`, so this is belt and braces — and it is cheap
  # insurance against a hypertable conversion failing half way through a
  # migration, which leaves a database nobody can migrate forward.
  docker exec -e PGPASSWORD=skydrop "$PG_CONTAINER" \
    psql -U skydrop -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' >/dev/null 2>&1 || true
}

# `packages/db/.env` ALSO carries a DATABASE_URL, and it names stack A's
# database. The Prisma CLI loads that file, so everything here rests on
# dotenv not overriding a variable the environment already set — true,
# and verified below rather than trusted, because if it ever stopped
# being true this function would migrate and RESEED stack A: 169 system
# settings and 86 notification templates upserted into a database
# somebody is filming against.
migrate_and_seed() {
  say "prisma migrate deploy  → $DB_NAME"
  (cd "$ROOT" && DATABASE_URL="$DATABASE_URL" pnpm --filter @skydrop/db migrate:deploy >/dev/null)
  local tables
  tables="$(docker exec -e PGPASSWORD=skydrop "$PG_CONTAINER" psql -U skydrop -d "$DB_NAME" \
    -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ')"
  if [ "${tables:-0}" -lt 100 ]; then
    echo "migrate deploy left $DB_NAME with ${tables:-0} tables — it migrated somewhere else."
    echo "Check that packages/db/.env is not overriding DATABASE_URL."
    exit 1
  fi
  say "$DB_NAME has $tables tables"
  say "prisma db seed"
  (cd "$ROOT" && DATABASE_URL="$DATABASE_URL" pnpm --filter @skydrop/db seed >/dev/null)
}

# Start a process unless its health URL already answers. A stack that is
# half up is the ordinary case — somebody started the API by hand — and
# starting a second one on the same port would fail loudly on one of them
# and leave the take wondering which it was talking to.
start_one() {
  local what="$1" health="$2" dir="$3"
  shift 3
  if up "$health"; then
    say "$what already answering on $health"
    return 0
  fi
  mkdir -p "$RUN_DIR"
  # `setsid` puts the server in its OWN session, so it survives the
  # terminal that started it closing, and `nohup` covers the case where
  # setsid has to fork. `</dev/null` so nothing ever blocks on a read
  # from a terminal that is no longer there.
  ( cd "$dir" && setsid nohup "$@" >>"$RUN_DIR/$what.log" 2>&1 </dev/null &
    echo $! >"$RUN_DIR/$what.pid" )
  say "$what starting (log $RUN_DIR/$what.log)"
}

wait_for() {
  local what="$1" url="$2" tries="${3:-60}"
  for _ in $(seq 1 "$tries"); do
    up "$url" && { say "$what up"; return 0; }
    sleep 1
  done
  echo "$what never answered on $url — see $RUN_DIR/$what.log"
  exit 1
}

if [ "$CMD" = "up" ]; then
  echo "Bringing filming stack \"$STACK_NAME\" up"
  load_stack_env
  ensure_database
  migrate_and_seed

  [ -f "$ROOT/apps/api/dist/main.js" ] \
    || { echo "apps/api is not built — pnpm --filter @skydrop/api build"; exit 1; }
  [ -f "$ROOT/apps/seller/.next/BUILD_ID" ] \
    || { echo "apps/seller is not built — pnpm --filter @skydrop/seller build"; exit 1; }
  [ -f "$ROOT/apps/admin/.next/BUILD_ID" ] \
    || { echo "apps/admin is not built — pnpm --filter @skydrop/admin build"; exit 1; }
  # The reseller portal — the store's OWN staff sign in here, and section
  # R of the curriculum is filmed against it. Its absence was why the
  # reseller app had ports in `lib/stacks.mjs` and no process to use them.
  [ -f "$ROOT/apps/reseller/.next/BUILD_ID" ] \
    || { echo "apps/reseller is not built — pnpm --filter @skydrop/reseller build"; exit 1; }
  # ASSOC-1 — the associate portal. The same absence the comment above
  # describes, one app later: it had ports in `lib/stacks.mjs` and no
  # process to use them until the long videos needed to film it.
  [ -f "$ROOT/apps/associate/.next/BUILD_ID" ] \
    || { echo "apps/associate is not built — pnpm --filter @skydrop/associate build"; exit 1; }

  start_one api "$API_URL/health" "$ROOT/apps/api" node dist/main.js
  wait_for api "$API_URL/health"
  # The simulator posts its signed webhooks at SKYDROP_API_URL, which the
  # stack env has already pointed at THIS stack's API — that is what
  # stops stack B's parcel scans landing in stack A's database.
  # `PORT` IS THE API's, so the simulator must be handed its OWN. Both
  # read `process.env.PORT` and the stack environment sets it for the
  # API, so the first attempt at this started a simulator that tried to
  # bind 4100, got EADDRINUSE from the API already sitting there, and
  # died — the one process whose job is to answer on a different port
  # being the one that inherited the wrong one.
  start_one sim "$SIM_URL_V/_sim/parcels" "$ROOT/apps/delhivery-sim" \
    env PORT="$SIM_PORT" SIM_SELF_URL="$SIM_URL_V" npx tsx src/server.ts
  wait_for sim "$SIM_URL_V/_sim/parcels"
  # `-p` beats the inherited PORT for `next start`, but PORT is unset
  # explicitly all the same: a server that silently picks up the API's
  # port is the failure above, and it should be impossible twice.
  start_one seller "$SELLER_URL/login" "$ROOT/apps/seller" \
    env PORT="$SELLER_PORT" npx next start -p "$SELLER_PORT" -H 127.0.0.1
  start_one admin "$ADMIN_URL/login" "$ROOT/apps/admin" \
    env PORT="$ADMIN_PORT" npx next start -p "$ADMIN_PORT" -H 127.0.0.1
  start_one reseller "$RESELLER_URL/login" "$ROOT/apps/reseller" \
    env PORT="$RESELLER_PORT" npx next start -p "$RESELLER_PORT" -H 127.0.0.1
  start_one associate "$ASSOCIATE_URL/login" "$ROOT/apps/associate" \
    env PORT="$ASSOCIATE_PORT" npx next start -p "$ASSOCIATE_PORT" -H 127.0.0.1
  wait_for seller "$SELLER_URL/login"
  wait_for admin "$ADMIN_URL/login"
  wait_for reseller "$RESELLER_URL/login"
  wait_for associate "$ASSOCIATE_URL/login"

  echo
  node "$ROOT/scripts/tutorials/provision-stack.mjs"
  echo
  status
  echo
  echo "Film on it with:"
  echo "  TUT_STACK=$STACK_NAME scripts/tutorials/make-tutorials.sh <slug>"
  exit 0
fi

# Kill a pid and everything under it, DEPTH FIRST — never a process group.
#
# `kill -- -<pgid>` is the obvious way to take down a server and its
# children, and it is a trap here: a non-interactive shell does NOT get
# its own process group, so `stack.sh up b` run from a script puts the
# servers in the CALLER's group, and `down` would then kill the caller's
# own shell. Walking `pgrep -P` costs nothing and cannot do that. The
# recorded pid may be a wrapper subshell rather than the server itself
# (`$!` of a backgrounded compound is the subshell), which is exactly why
# the walk matters rather than being tidiness.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

# Stop some of this stack's processes and start them again — which is
# almost always "the other agent rebuilt apps/admin under me".
#
#   scripts/tutorials/stack.sh restart b admin
#   scripts/tutorials/stack.sh restart b            # all four
#
# It stops what it is told and then re-runs `up`, which starts whatever
# is no longer answering. Deliberately not a second copy of the start
# commands: those live in exactly one place, and a restart that drifts
# from the start is a server running with an environment nobody chose.
if [ "$CMD" = "restart" ]; then
  shift 2
  WHICH=("$@")
  [ ${#WHICH[@]} -gt 0 ] || WHICH=(api sim seller admin reseller associate)
  if [ ! -d "$RUN_DIR" ]; then
    echo "Stack \"$STACK_NAME\" was not started by this script (no $RUN_DIR) — nothing to restart."
    exit 0
  fi
  for what in "${WHICH[@]}"; do
    pidfile="$RUN_DIR/$what.pid"
    if [ ! -e "$pidfile" ]; then
      # STARTED BY HAND, so there is no pidfile — which used to print
      # "leaving it alone" and return, while the old process kept the
      # port and kept serving the build it loaded at boot. `status` would
      # then say STALE and tell you to run this command, which did
      # nothing: a remedy that reads as applied and is not. Measured on
      # admin 2026-10-09 — a 42-minute-old process serving HTML for
      # chunks that no longer existed, so the page never hydrated and the
      # sign-in simply timed out.
      #
      # Adopting it off the PORT is safe here in a way `down` is right to
      # refuse: the port belongs to this stack by definition
      # (`lib/stacks.mjs`), and the cwd is checked against this repo's own
      # app directory before anything is signalled. Anything else keeps
      # the port and is reported rather than killed.
      adopt_url=""
      case "$what" in
        seller) adopt_url="$SELLER_URL" ;;
        admin) adopt_url="$ADMIN_URL" ;;
        reseller) adopt_url="$RESELLER_URL" ;;
        associate) adopt_url="$ASSOCIATE_URL" ;;
        api) adopt_url="$API_URL" ;;
      esac
      adopt_port="${adopt_url##*:}"
      adopt_pid=""
      if [ -n "$adopt_port" ]; then
        adopt_pid="$(ss -ltnpH "sport = :$adopt_port" 2>/dev/null \
          | grep -oP 'pid=\K[0-9]+' | head -1)"
      fi
      if [ -z "$adopt_pid" ]; then
        say "$what has no pidfile here and nothing is on port $adopt_port — leaving it alone"
        continue
      fi
      adopt_cwd="$(readlink "/proc/$adopt_pid/cwd" 2>/dev/null || true)"
      case "$adopt_cwd" in
        "$ROOT/apps/$what" | "$ROOT")
          kill_tree "$adopt_pid"
          say "$what (pid $adopt_pid, started by hand in $adopt_cwd) stopped"
          ;;
        *)
          say "$what on port $adopt_port is pid $adopt_pid in ${adopt_cwd:-an unknown directory} — NOT this stack's, left alone"
          continue
          ;;
      esac
      continue
    fi
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
      say "$what (pid $pid and children) stopped"
    fi
    rm -f "$pidfile"
  done
  # The port is not free the instant the process is signalled.
  sleep 2
  exec "$0" up "$STACK_NAME"
fi

if [ "$CMD" = "down" ]; then
  # ONLY processes this script started, read from its own pidfiles. Stack
  # A was started by hand in somebody's terminal and has no pidfile here,
  # so `down a` stops nothing rather than guessing from a port — killing
  # a process off a port number is how you end a colleague's take.
  if [ ! -d "$RUN_DIR" ]; then
    echo "Stack \"$STACK_NAME\" was not started by this script (no $RUN_DIR) — nothing to stop."
    exit 0
  fi
  for pidfile in "$RUN_DIR"/*.pid; do
    [ -e "$pidfile" ] || continue
    what="$(basename "$pidfile" .pid)"
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid"
      say "$what (pid $pid and children) stopped"
    else
      say "$what (pid $pid) was not running"
    fi
    rm -f "$pidfile"
  done
  status || true
  exit 0
fi

if [ "$CMD" = "status" ]; then
  status || true
  exit 0
fi

usage
