#!/usr/bin/env bash
#
# Make every tutorial video, end to end.
#
#   TUT_STACK=a scripts/tutorials/make-tutorials.sh                   # all of them
#   TUT_STACK=a scripts/tutorials/make-tutorials.sh place-an-order    # just one
#
# TUT_STACK IS REQUIRED AND HAS NO DEFAULT. Two agents film at once
# against two whole stacks — a database, a Redis logical DB, four ports
# and a bucket each — and `lib/stacks.mjs` is the one table that says
# which belongs to whom. A default of `a` would mean an agent filming on
# B reseeds A by forgetting a flag, and because a seed REBUILDS the demo
# world the other agent's take would simply start showing the wrong
# thing, with nothing anywhere reporting an error. Bring a stack up with
# `scripts/tutorials/stack.sh up <name>`.
#
# Prerequisites (it checks, and says which one is missing):
#   - Postgres + Redis:  pnpm db:up
#   - the stack's api, seller and admin, built and STARTED (not
#     `next dev` — the dev overlay would be in the picture);
#     `stack.sh up <name>` does all of it
#   - ffmpeg / ffprobe on PATH
#   - an ElevenLabs key in ~/.config/skydrop/elevenlabs or $ELEVENLABS_API_KEY
#
# The seed runs BEFORE EACH video, not once: the product video creates a
# product on camera, the bulk-import video creates four orders and an
# import record, and neither must be in the world the next one films.
# Seeding per video is what makes any one of them re-takeable on its own.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"

# WHICH STACK, resolved before anything else so a typo costs one line.
STACK_NAME="${TUT_STACK:-}"
if [ -z "$STACK_NAME" ]; then
  node "$ROOT/scripts/tutorials/lib/stacks.mjs" --env || true
  exit 1
fi

# THE SECRETS FIRST, THE STACK SECOND — and the order is load-bearing.
#
# `apps/api/.env` hard-sets DATABASE_URL to stack A's database, REDIS_URL
# to logical DB 0, and a SELLER_APP_URL of its own (port 3001, the API's
# idea of where the seller app lives for link-building). `set -a` exports
# every one of them into everything below, so applying it AFTER the stack
# would point a stack-B run at stack A's world while the health checks
# passed against B — which is exactly the shape of the bug this ordering
# comment used to be about, one layer deeper. Everything the stacks table
# owns is re-exported by the `eval`; everything else (the JWT key, the
# courier encryption key, the webhook secret, DEV_MOCK_SPACES) is shared
# on purpose, because a filming stack is not a second deployment.
if [ -f "$ROOT/apps/api/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/apps/api/.env"
  set +a
fi
eval "$(node "$ROOT/scripts/tutorials/lib/stacks.mjs" --env "$STACK_NAME")"

API_URL="$SKYDROP_API_URL"
SELLER_URL="$SELLER_APP_URL"
ADMIN_URL="$ADMIN_APP_URL"

echo "Filming on stack \"$STACK_NAME\"  (api $API_URL  seller $SELLER_URL  admin $ADMIN_URL)"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing $1 on PATH."; exit 1; }
}
need node
need ffmpeg
need ffprobe

up() {
  curl -fsS -o /dev/null --max-time 5 "$1" 2>/dev/null
}
up "$API_URL/health" || { echo "apps/api is not answering on $API_URL — start it first."; exit 1; }

# The key LIST wins, and this order is load-bearing. There is more than
# one ElevenLabs account because one month's allowance is smaller than one
# section of the library, and `generate-voice.mjs` reads the list itself.
# Exporting the old single-key file unconditionally — which is what this
# did — would put ELEVENLABS_API_KEY in the environment of a two-key
# machine and quietly run the whole batch on one account, reporting a
# quota failure that was never real.
if [ ! -f "$HOME/.config/skydrop/elevenlabs-keys" ] \
  && [ -z "${ELEVENLABS_API_KEYS:-}" ] \
  && [ -z "${ELEVENLABS_API_KEY:-}" ] \
  && [ -f "$HOME/.config/skydrop/elevenlabs" ]; then
  ELEVENLABS_API_KEY="$(cat "$HOME/.config/skydrop/elevenlabs")"
  export ELEVENLABS_API_KEY
fi

# Keep the recorder off the machine's throat: one Chromium and one
# ffmpeg at a time is plenty, and a 3 GB cap leaves room for the API,
# the seller app and Postgres beside it.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

SLUGS=("$@")
if [ ${#SLUGS[@]} -eq 0 ]; then
  SLUGS=(
    find-your-way-around
    set-up-your-profile
    place-an-order
    add-a-product-with-variations
    upload-bulk-orders
    announce-a-consignment
  )
fi

# WHICH CONSOLE each requested video drives, asked of `flows.mjs` rather
# than guessed from the slug. Sections A–G are apps/seller and H–P are
# apps/admin, so a run of one does not need the other to be up — and a
# missing admin app should say "start apps/admin", not fail thirty
# seconds later inside Playwright with a connection refused.
APPS_NEEDED="$(node -e '
import("./scripts/tutorials/flows.mjs").then(({ FLOWS }) => {
  const apps = new Set(process.argv.slice(1).map((s) => FLOWS[s]?.app ?? "seller"));
  process.stdout.write([...apps].join(" "));
});' "${SLUGS[@]}")"

# …and whether the one that IS up is still serving the build on disk.
#
# `apps/*/.next` is shared between filming stacks and is read-only at RUN
# time, which is not the same as read-only. Somebody rebuilding the app —
# the other agent, filming a fix of their own — replaces every hashed
# chunk under a `next start` that keeps naming the ones it booted with.
# The server answers, `/login` renders, and nothing on the page hydrates:
# sign-in submits nothing and the take dies at `page.waitForURL`, which
# is indistinguishable from a moved selector. It cost two check runs on
# 2026-10-01. Asking for the chunk the page just asked for is the failure
# itself rather than a proxy for it.
fresh() {
  local chunk
  chunk="$(curl -fsS --max-time 5 "$1/login" 2>/dev/null \
    | grep -oE '/_next/static/chunks/[A-Za-z0-9._-]+\.js' | head -1)" || return 0
  [ -n "$chunk" ] || return 0
  curl -fsS -o /dev/null --max-time 5 "$1$chunk" 2>/dev/null
}
stale() {
  echo "$1 on $2 is serving a build that has been replaced — somebody rebuilt it under it."
  echo "Restart it:  scripts/tutorials/stack.sh restart $STACK_NAME $3"
  exit 1
}
case " $APPS_NEEDED " in
  *" seller "*)
    up "$SELLER_URL/login" \
      || { echo "apps/seller is not answering on $SELLER_URL — start it first."; exit 1; }
    fresh "$SELLER_URL" || stale apps/seller "$SELLER_URL" seller ;;
esac
case " $APPS_NEEDED " in
  *" admin "*)
    up "$ADMIN_URL/login" \
      || { echo "apps/admin is not answering on $ADMIN_URL — start it first."; exit 1; }
    fresh "$ADMIN_URL" || stale apps/admin "$ADMIN_URL" admin ;;
esac

for slug in "${SLUGS[@]}"; do
  echo
  echo "=============================================================="
  echo "  $slug"
  echo "=============================================================="
  # The slug is passed so the seed can tailor the world per video — the
  # orientation video wants a dashboard with orders on it, and every
  # other video wants the order list cleared.
  # Sign-in is throttled 5 per 15 minutes per email+IP, and a video costs
  # three sign-ins (two checks and the take) — so the fourth video in any
  # quarter of an hour is refused at the login screen. A LOCAL counter,
  # cleared locally; the helper refuses a non-local Redis.
  node scripts/tutorials/lib/clear-login-throttle.mjs
  node scripts/tutorials/seed-demo-data.mjs "$slug"
  node scripts/tutorials/generate-voice.mjs "$slug"
  node scripts/tutorials/record.mjs "$slug"
  node scripts/tutorials/compose.mjs "$slug"
  node scripts/tutorials/verify.mjs "$slug"
done

echo
echo "Done. Videos are in scripts/tutorials/out/ (shared between stacks):"
ls -lh "$ROOT/scripts/tutorials/out"/*.mp4 2>/dev/null || true
