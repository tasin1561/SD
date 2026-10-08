#!/usr/bin/env bash
#
# Buy the narration for the long videos and the promos, one language.
#
#   scripts/tutorials/voice-long-videos.sh en
#   scripts/tutorials/voice-long-videos.sh bn promo-seller
#
# NAMED SLUGS, never a bare run. `generate-voice.mjs` with no slug walks
# EVERY video in the library — 99 of them — and while the cache means it
# buys nothing it already has, that is a lot of requests to make by
# accident when six were wanted.
#
# The cache is keyed on the TEXT plus the voice and the model, so a
# narration line corrected after a take costs only that line. That is
# what makes it safe to buy audio while the flows are still being shaken
# down: a wording fix bills a sentence, not a video.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LANG_CODE="${1:-en}"
shift || true

ALL=(
  seller-everything
  reseller-everything
  associate-everything
  promo-seller
  promo-reseller
  promo-associate
)
SLUGS=("$@")
[ ${#SLUGS[@]} -eq 0 ] && SLUGS=("${ALL[@]}")

LOGS="$ROOT/scripts/tutorials/out/voicelogs"
mkdir -p "$LOGS"

ok=0
bad=0
for slug in "${SLUGS[@]}"; do
  log="$LOGS/$slug.$LANG_CODE.log"
  printf '=== %s (%s) ===\n' "$slug" "$LANG_CODE"
  if [ "$LANG_CODE" = "en" ]; then
    timeout 3600 node scripts/tutorials/generate-voice.mjs "$slug" >"$log" 2>&1
  else
    timeout 3600 node scripts/tutorials/generate-voice.mjs --lang="$LANG_CODE" "$slug" >"$log" 2>&1
  fi
  code=$?
  if [ $code -eq 0 ]; then
    ok=$((ok + 1))
    grep -E 'total narration' "$log" | tail -1 | sed 's/^/    /'
  else
    bad=$((bad + 1))
    printf '    FAILED (exit %d)\n' "$code"
    grep -iE 'error|refus|exhaust|quota|untranslated' "$log" | head -4 | sed 's/^/      /'
  fi
done

printf '\n%d done, %d failed — logs in %s\n' "$ok" "$bad" "$LOGS"
[ $bad -eq 0 ]
