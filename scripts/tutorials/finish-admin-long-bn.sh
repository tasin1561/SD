#!/usr/bin/env bash
#
# The Bangla admin long video, end to end: voice, seed, record, compose,
# deliver — with the same gates the English take needed, because every
# one of them caught something real.
#
#   · the recorder writes `scenes.json` even when it FAILS half way, and
#     compose iterates that manifest rather than the narration, so a
#     take that stopped early composes a short video and reports success
#   · marker detection walks forward through 303 boundaries with a
#     16-colour palette; compose computes drift and only LOGS it
#   · the delivery script prints "EVERY VIDEO DELIVERED" once the slugs
#     it lists are done, so the only proof is looking at the destination
#
# A Bangla take is LONGER than the English one — 11.9 chars/sec against
# ~14 — so the expected runtime is ~115 min, not 90.
#
# Usage:  bash scripts/tutorials/finish-admin-long-bn.sh
set -u
cd /home/talha/projects/SD
SLUG=admin-everything
RAW=scripts/tutorials/out/raw/$SLUG-bn/scenes.json
OUT=scripts/tutorials/out/$SLUG-bn.mp4
DEST="/mnt/c/Users/User/Downloads/Skydrop - Bangla - 4 - Admin.mp4"

say() { printf '\n=== %s\n' "$*"; }
eval "$(bash scripts/tutorials/stack.sh env a)"
throttle() {
  node --input-type=module -e "
    const m = await import('./scripts/tutorials/lib/clear-login-throttle.mjs');
    await m.clearLoginThrottle({ log: () => {} });
  " >/dev/null 2>&1 || true
}

# ── 1. voice ────────────────────────────────────────────────────────
# All-or-nothing by design: it prices the whole video up front and
# refuses rather than leaving half of it bought. Cached per clip by
# fingerprint, so a re-run after a failure re-buys nothing.
say "voicing (Bangla)"
node scripts/tutorials/generate-voice.mjs --lang=bn "$SLUG" 2>&1 | tail -6
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "ABORT: voicing failed."; exit 1; }
clips=$(ls scripts/tutorials/out/audio/$SLUG-bn/*.mp3 2>/dev/null | wc -l)
echo "clips on disk: $clips"
[ "$clips" -eq 302 ] || { echo "ABORT: $clips clips, expected 302."; exit 1; }

# ── 2. seed ─────────────────────────────────────────────────────────
# A take CONSUMES its world — the call it films, the box it opens, the
# adjustment it approves — so the recording needs its own fresh seed.
say "seeding"
throttle
timeout 900 node scripts/tutorials/seed-demo-data.mjs "$SLUG" --lifecycle > /tmp/seed-bn.log 2>&1
[ $? -eq 0 ] || { echo "ABORT: seed failed."; tail -5 /tmp/seed-bn.log; exit 1; }
grep -aE "pulled it onto|timeout\(s\) widened|freight bill standing|APPROVED" /tmp/seed-bn.log | cut -c1-120

# ── 3. record ───────────────────────────────────────────────────────
# Its own take, not the English footage: Bangla runs ~1.27x longer, and
# reusing would stretch every scene to ~79% speed for two hours.
say "recording (~115 min)"
timeout 10800 node scripts/tutorials/record.mjs --lang=bn "$SLUG" > /tmp/record-bn.log 2>&1
code=$?
echo "record exit=$code  scenes: $(grep -acE 'clip [0-9.]+s +scene' /tmp/record-bn.log)"
if [ "$code" -ne 0 ]; then
  grep -aE 'waiting for|admin.mjs:[0-9]+' /tmp/record-bn.log | head -3 | cut -c1-170
  echo "ABORT: the take did not finish."
  exit 1
fi
[ -f "$RAW" ] || { echo "ABORT: no $RAW"; exit 1; }
scenes=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$RAW','utf8')).scenes.length)")
echo "scenes in manifest: $scenes"
[ "$scenes" = "302" ] || { echo "ABORT: $scenes scenes, not 302 — composing this would be a short video."; exit 1; }

# ── 4. compose ──────────────────────────────────────────────────────
say "composing (2-4 hours, silent)"
unset TUT_STACK
start=$(date +%s)
node scripts/tutorials/compose.mjs --lang=bn "$SLUG" 2>&1 | tail -25
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "ABORT: compose failed."; exit 1; }
echo "compose wall=$(( ($(date +%s) - start) / 60 ))m"

# ── 5. sanity ───────────────────────────────────────────────────────
say "checking the composed video"
[ -f "$OUT" ] || { echo "ABORT: no $OUT"; exit 1; }
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | cut -d. -f1)
printf 'duration: %ss (%sm)  size: %s MB\n' "$dur" "$((dur / 60))" "$(( $(stat -c %s "$OUT") / 1048576 ))"
# ~115 min expected; well outside that means dropped scenes or bad retime.
if [ "$dur" -lt 6200 ] || [ "$dur" -gt 7600 ]; then
  echo "ABORT: $((dur / 60)) minutes is not the ~115 expected."
  exit 1
fi
node -e "
  try { console.log('marker drift:', JSON.parse(require('fs').readFileSync('scripts/tutorials/out/work/$SLUG-bn/timeline.json','utf8')).drift); }
  catch { console.log('marker drift: unknown'); }
"

# ── 6. deliver, and PROVE it ────────────────────────────────────────
say "delivering"
bash scripts/tutorials/deliver-to-downloads.sh --once 2>&1 | tail -18
[ -f "$DEST" ] || { echo "ABORT: delivery reported done but nothing is at:"; echo "  $DEST"; exit 1; }
printf 'DELIVERED: %s (%s MB)\n' "$DEST" "$(( $(stat -c %s "$DEST") / 1048576 ))"
say "done — the Bangla admin video is in Downloads"
