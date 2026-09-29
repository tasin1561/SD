#!/usr/bin/env bash
#
# Make both tutorial videos, end to end.
#
#   scripts/tutorials/make-tutorials.sh                     # both
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
# product on camera, and the order video's catalogue must not show it.
# Seeding per video is what makes either one re-takeable on its own.
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
  SLUGS=(place-an-order add-a-product-with-variations)
fi

for slug in "${SLUGS[@]}"; do
  echo
  echo "=============================================================="
  echo "  $slug"
  echo "=============================================================="
  node scripts/tutorials/seed-demo-data.mjs
  node scripts/tutorials/generate-voice.mjs "$slug"
  node scripts/tutorials/record.mjs "$slug"
  node scripts/tutorials/compose.mjs "$slug"
  node scripts/tutorials/verify.mjs "$slug"
done

echo
echo "Done. Videos are in scripts/tutorials/out/ :"
ls -lh "$ROOT/scripts/tutorials/out"/*.mp4 2>/dev/null || true
