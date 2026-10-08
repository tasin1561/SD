#!/usr/bin/env bash
#
# Drive the long videos and the promos in CHECK mode — one at a time,
# each to its own log.
#
#   scripts/tutorials/check-long-videos.sh a                 # all six
#   scripts/tutorials/check-long-videos.sh a seller-everything
#
# WHY A SCRIPT RATHER THAN THE COMMAND. Two things kept going wrong by
# hand. A `node … | grep | tail` BUFFERS: nothing reaches the file until
# the process exits, so a twelve-minute run looks hung and three
# separate attempts were abandoned as silent when they were working.
# And `pkill -f record.mjs` matches the shell that runs it, so cleaning
# up killed the caller (exit 144) along with the run.
#
# So: no pipe on the node call, and nothing here kills by pattern.
#
# Check mode fabricates its own 0.4s beat per scene, so it reads no
# audio and spends no ElevenLabs characters — which is the whole reason
# every flow is shaken down here before a single clip is bought.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STACK="${1:-a}"
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

LOGS="$ROOT/scripts/tutorials/out/checklogs"
mkdir -p "$LOGS"

eval "$(bash scripts/tutorials/stack.sh env "$STACK")"

pass=0
fail=0
for slug in "${SLUGS[@]}"; do
  log="$LOGS/$slug.log"
  seedlog="$LOGS/$slug.seed.log"
  printf '=== %s ===\n' "$slug"

  # CLEAR THE LOGIN THROTTLE FIRST, and again before the check.
  #
  # Seller sign-in is throttled 5 per 15 minutes per email+IP, and a
  # sweep like this costs TWO sign-ins per video — the seed's API login
  # and the browser's. Six videos is twelve, so the third video onward
  # is refused at the login screen whatever the flow does, and the
  # refusal reads as a broken script.
  #
  # Worse, a REFUSED attempt writes its own `blocked` key with a fresh
  # TTL, so retrying because the window "should" have passed pushes the
  # window further out — which is exactly what happened on the first
  # sweep: twelve logins in a row left every later seed answering 429.
  node scripts/tutorials/lib/clear-login-throttle.mjs >/dev/null 2>&1 || true

  # SEED FIRST, PER SLUG — not once for the sweep. The world is tailored
  # by slug: `ravi@punesilkstudio.test` is only created for the
  # associate videos, Pune Silk Studio's wallet is only put under
  # Skydrop for the store ones, and the three bulk-order CSVs are each
  # written for their own video. Checking the associate flow against a
  # seller-seeded world fails at sign-in on a person who was never
  # made, which reads as a broken login rather than a missing seed.
  timeout 1800 node scripts/tutorials/seed-demo-data.mjs "$slug" >"$seedlog" 2>&1
  seedcode=$?
  if [ $seedcode -ne 0 ]; then
    fail=$((fail + 1))
    printf '    FAIL  %s — the SEED failed (exit %d)\n' "$slug" "$seedcode"
    grep -vE '^prisma:query' "$seedlog" | grep -iE 'error|invalid|unknown|refus' \
      | head -5 | sed 's/^/      /'
    continue
  fi

  # Again: the seed above just spent one of the five.
  node scripts/tutorials/lib/clear-login-throttle.mjs >/dev/null 2>&1 || true

  timeout 1800 node scripts/tutorials/record.mjs --check "$slug" >"$log" 2>&1
  code=$?
  if [ $code -eq 0 ]; then
    pass=$((pass + 1))
    printf '    PASS  %s\n' "$slug"
  else
    fail=$((fail + 1))
    printf '    FAIL  %s (exit %d)\n' "$slug" "$code"
    # The reason, not the stack: a moved selector reports as a timeout
    # whose message names the locator, and that one line is the fix.
    grep -vE '^prisma:query' "$log" \
      | grep -iE 'completed scenes|Error|Timeout|strict mode|resolved to|refus' \
      | head -6 \
      | sed 's/^/      /'
  fi
done

printf '\n%d passed, %d failed — logs in %s\n' "$pass" "$fail" "$LOGS"
[ $fail -eq 0 ]
