#!/usr/bin/env bash
#
# Make every tutorial video, end to end.
#
#   scripts/tutorials/make-tutorials.sh                     # all of them
#   scripts/tutorials/make-tutorials.sh place-an-order      # just one
#
# Prerequisites (it checks, and says which one is missing):
#   - Postgres + Redis:  pnpm db:up
#   - apps/api on :4000
#   - apps/seller on :3003, built and started (NOT `next dev` — the dev
#     overlay would be in the picture)
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

API_URL="${SKYDROP_API_URL:-http://127.0.0.1:4000}"
SELLER_URL="${SELLER_APP_URL:-http://127.0.0.1:3003}"

# The seed talks to Prisma directly as well as to the API.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/apps/api/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/apps/api/.env"
  set +a
fi

# EXPORT what the checks above resolved, AFTER the .env sourcing —
# `apps/api/.env` carries a `SELLER_APP_URL` of its own (port 3001, the
# API's idea of where the seller app lives for link-building), and `set -a`
# exports it into everything below. The health check ran before that and
# passed against 3003; `record.mjs` ran after it and drove a browser at
# 3001, where nothing was listening. Resolving the two names in one place
# is what stops the checker and the camera looking at different apps.
export SKYDROP_API_URL="$API_URL"
export SELLER_APP_URL="$SELLER_URL"

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
up "$SELLER_URL/login" || { echo "apps/seller is not answering on $SELLER_URL — start it first."; exit 1; }

if [ -z "${ELEVENLABS_API_KEY:-}" ] && [ -f "$HOME/.config/skydrop/elevenlabs" ]; then
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

for slug in "${SLUGS[@]}"; do
  echo
  echo "=============================================================="
  echo "  $slug"
  echo "=============================================================="
  # The slug is passed so the seed can tailor the world per video — the
  # orientation video wants a dashboard with orders on it, and every
  # other video wants the order list cleared.
  node scripts/tutorials/seed-demo-data.mjs "$slug"
  node scripts/tutorials/generate-voice.mjs "$slug"
  node scripts/tutorials/record.mjs "$slug"
  node scripts/tutorials/compose.mjs "$slug"
  node scripts/tutorials/verify.mjs "$slug"
done

echo
echo "Done. Videos are in scripts/tutorials/out/ :"
ls -lh "$ROOT/scripts/tutorials/out"/*.mp4 2>/dev/null || true
