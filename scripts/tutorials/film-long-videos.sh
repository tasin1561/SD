#!/usr/bin/env bash
#
# Film the long videos and the promos, end to end, in one language.
#
#   scripts/tutorials/film-long-videos.sh a
#   scripts/tutorials/film-long-videos.sh a seller-everything
#
# Per video: clear the login throttle, seed the world, make sure the
# narration is bought, record, compose. Exactly what
# `make-tutorials.sh` does for the rest of the library — restated here
# only because that script walks the whole 99-video list and these six
# want to be filmable on their own.
#
# SERIAL, AND IT HAS TO BE. The seed REBUILDS the demo world before each
# take, so two of these running at once would reseed under each other
# and both takes would quietly film the wrong thing. One stack, one
# video at a time.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STACK="${1:-a}"
shift || true

# `--lang=bn` anywhere after the stack. English is the default, so every
# command that already worked keeps producing the same English video.
LANG_CODE=en
REST=()
for a in "$@"; do
  case "$a" in
    --lang=*) LANG_CODE="${a#--lang=}" ;;
    *) REST+=("$a") ;;
  esac
done
set -- "${REST[@]+"${REST[@]}"}"
LANG_SUFFIX=""
[ "$LANG_CODE" != "en" ] && LANG_SUFFIX="-$LANG_CODE"

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

# PER STACK, and this is the one that matters more than the mp4.
#
# `out/<slug>.mp4` is shared between stacks (RAW_DIR, WORK_DIR,
# VERIFY_DIR and GENERATED_DIR all take a stack suffix; OUT_DIR does
# not), so two stacks filming one slug overwrite the finished video —
# and the loser never knows. The log was shared too, and this script
# TRUNCATES it at the start of every take, so the same collision also
# destroyed the diagnostics you would use to notice the first one.
#
# Splitting the logs costs nothing and keeps the evidence; the mp4 is
# kept un-suffixed deliberately, because the finished video is the
# deliverable and a `promo-seller-b.mp4` would be a worse thing to hand
# somebody. Give each stack different SLUGS instead — that is what makes
# the shared output safe.
LOGS="$ROOT/scripts/tutorials/out/filmlogs-$STACK$LANG_SUFFIX"
mkdir -p "$LOGS"

eval "$(bash scripts/tutorials/stack.sh env "$STACK")"

made=0
failed=0
for slug in "${SLUGS[@]}"; do
  printf '=== %s (%s) ===\n' "$slug" "$LANG_CODE"
  log="$LOGS/$slug.log"

  # Each stage appends, so one log holds the whole story of a take.
  : >"$log"
  for stage in throttle seed voice record compose; do
    case "$stage" in
      throttle) cmd=(node scripts/tutorials/lib/clear-login-throttle.mjs) ;;
      seed) cmd=(node scripts/tutorials/seed-demo-data.mjs "$slug") ;;
      # The SEED takes no language — the world a take films is the same
      # whatever is being said over it. The other three do.
      voice)
        if [ "$LANG_CODE" = "en" ]; then
          cmd=(node scripts/tutorials/generate-voice.mjs "$slug")
        else
          cmd=(node scripts/tutorials/generate-voice.mjs "--lang=$LANG_CODE" "$slug")
        fi
        ;;
      record)
        if [ "$LANG_CODE" = "en" ]; then
          cmd=(node scripts/tutorials/record.mjs "$slug")
        else
          cmd=(node scripts/tutorials/record.mjs "--lang=$LANG_CODE" "$slug")
        fi
        ;;
      compose)
        if [ "$LANG_CODE" = "en" ]; then
          cmd=(node scripts/tutorials/compose.mjs "$slug")
        else
          cmd=(node scripts/tutorials/compose.mjs "--lang=$LANG_CODE" "$slug")
        fi
        ;;
    esac
    printf -- '--- %s ---\n' "$stage" >>"$log"
    if ! timeout 3600 "${cmd[@]}" >>"$log" 2>&1; then
      failed=$((failed + 1))
      printf '    FAILED at %s\n' "$stage"
      grep -vE '^prisma:query' "$log" | grep -iE 'error|refus|timeout|waiting for' \
        | head -5 | sed 's/^/      /'
      continue 2
    fi
  done

  made=$((made + 1))
  out="$ROOT/scripts/tutorials/out/$slug$LANG_SUFFIX.mp4"; [ -f "$out" ] || out=""
  if [ -n "$out" ]; then
    printf '    MADE  %s  (%s)\n' "$slug" "$(du -h "$out" | cut -f1)"
  else
    printf '    MADE  %s\n' "$slug"
  fi
done

printf '\n%d filmed, %d failed — logs in %s\n' "$made" "$failed" "$LOGS"
[ $failed -eq 0 ]
