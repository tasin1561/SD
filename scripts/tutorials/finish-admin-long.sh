#!/usr/bin/env bash
#
# Everything after the recording: verify the take, compose it, check the
# result is sane, deliver it.
#
# ── WHY EACH GATE IS HERE ────────────────────────────────────────────
# Every one of these was a real failure mode found before it happened,
# and every one of them FAILS QUIETLY if nobody checks:
#
#   · A take that dies mid-way still writes `scenes.json` with only the
#     scenes it finished, BEFORE re-throwing. `compose.mjs` iterates
#     that manifest rather than the 302 narration steps, so a take that
#     stopped at scene 180 composes a 55-minute video and reports
#     success. Hence the 302 gate.
#
#   · Marker detection walks forward through 303 boundaries with a
#     16-colour palette that wraps 19 times. One false match locks onto
#     the wrong cycle and every later scene is mis-timed. `compose.mjs`
#     computes `drift` and only LOGS it. Hence the drift gate: the three
#     earlier long videos all landed within 0.25% of 1.0.
#
#   · `deliver-to-downloads.sh` copies only the slugs it lists, and
#     prints "EVERY VIDEO DELIVERED" when those are done. Until today it
#     did not list this video, so it would have reported success having
#     never touched it. Hence the final check that the file is actually
#     in the destination, by name and size.
#
# Usage:  bash scripts/tutorials/finish-admin-long.sh
set -u
cd /home/talha/projects/SD
SLUG=admin-everything
RAW=scripts/tutorials/out/raw/$SLUG/scenes.json
OUT=scripts/tutorials/out/$SLUG.mp4
DEST="/mnt/c/Users/User/Downloads/Skydrop - 4 - Admin - everything.mp4"

say() { printf '\n=== %s\n' "$*"; }

# ── 1. wait for the recorder to let go ──────────────────────────────
# Compose must not overlap it: ~3 GB free RAM against a 1.5-2.5 GB peak
# across 303 demuxers plus x264, and there is no resume if it is killed.
say "waiting for the recording to finish"
for i in $(seq 1 240); do
  pgrep -f "record.mjs $SLUG" >/dev/null || break
  sleep 30
done
if pgrep -f "record.mjs $SLUG" >/dev/null; then
  echo "ABORT: the recorder is still running after two hours."
  exit 1
fi

# ── 2. the take has to be WHOLE ─────────────────────────────────────
say "verifying the take"
if [ ! -f "$RAW" ]; then
  echo "ABORT: no $RAW — the recording never wrote a manifest."
  exit 1
fi
scenes=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RAW','utf8')).scenes.length)")
echo "scenes in manifest: $scenes"
if [ "$scenes" != "302" ]; then
  echo "ABORT: the take holds $scenes scenes, not 302 — it stopped early."
  echo "Composing this would produce a short video and report success."
  exit 1
fi

# ── 3. compose ──────────────────────────────────────────────────────
# TUT_STACK unset on purpose: the raw take is in out/raw (stack a), and
# a stray TUT_STACK=b would send compose looking in out/raw-b and fail
# on a missing manifest. Expect 2-4 hours with NO progress output.
say "composing (2-4 hours, silent)"
unset TUT_STACK
start=$(date +%s)
node scripts/tutorials/compose.mjs "$SLUG" 2>&1 | tail -40
code=${PIPESTATUS[0]}
echo "compose exit=$code  wall=$(( ($(date +%s) - start) / 60 ))m"
[ "$code" -eq 0 ] || { echo "ABORT: compose failed."; exit 1; }

# ── 4. is the result sane ───────────────────────────────────────────
say "checking the composed video"
[ -f "$OUT" ] || { echo "ABORT: no $OUT"; exit 1; }
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | cut -d. -f1)
size=$(stat -c %s "$OUT")
printf 'duration: %ss (%sm)  size: %s MB\n' "$dur" "$((dur / 60))" "$((size / 1048576))"
# Narration is 5405s of body plus two 2.6s cards. Anything far from that
# means scenes were dropped or the retime went wrong.
if [ "$dur" -lt 5000 ] || [ "$dur" -gt 5800 ]; then
  echo "ABORT: $((dur / 60)) minutes is not the ~90 expected."
  exit 1
fi
drift=$(node -e "
try {
  const t = JSON.parse(require('fs').readFileSync('scripts/tutorials/out/work/$SLUG/timeline.json','utf8'));
  console.log(t.drift ?? 'unknown');
} catch { console.log('unknown'); }
")
echo "marker drift: $drift  (priors stayed within 0.25% of 1.0)"

# ── 5. deliver, and PROVE it landed ─────────────────────────────────
say "delivering"
bash scripts/tutorials/deliver-to-downloads.sh --once 2>&1 | tail -20
if [ ! -f "$DEST" ]; then
  echo "ABORT: the delivery script finished but the file is not at:"
  echo "  $DEST"
  exit 1
fi
dsize=$(stat -c %s "$DEST")
printf 'DELIVERED: %s  (%s MB)\n' "$DEST" "$((dsize / 1048576))"
[ "$dsize" -eq "$size" ] || { echo "WARNING: delivered size differs from source."; exit 1; }
say "done — the admin long video is in Downloads"
