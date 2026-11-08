#!/usr/bin/env bash
#
# Build the UNION of worlds the admin long video needs, then its own.
#
# ── WHY THIS EXISTS ──────────────────────────────────────────────────
# `long/admin.mjs` declares its seed as "the union of the worlds the
# short videos film, because this video visits all of them" — it walks
# every section of the console, so its 302 scenes want the pickups
# world, the returns bench, adjustments, cycle counts, manual placement,
# the money desk, leads, staff, freight and the rest.
#
# `seed-demo-data.mjs` builds ONE video's world per run: almost every
# `*WorldFor(slug, …)` opens with `if (slug !== '<some-video>') return;`.
# Seeding `admin-everything` alone therefore leaves roughly fifty scenes
# pointing at empty tables, which is indistinguishable on screen from a
# broken page.
#
# So each world is seeded by the slug that owns it, and the admin
# video's own world is built LAST — `superviseWorldFor` releases every
# assigned call and the pick/pack worlds retire each other's parcels
# forward, so anything built before them survives and anything built
# after would undo them.
#
# Takes roughly fifteen minutes. Run it before a filming session, not
# before every take: `film-long-videos.sh` re-seeds `admin-everything`
# on its own, which is the one world that has to be freshest.
#
# Usage:  bash scripts/tutorials/seed-admin-long-union.sh [stack]   # default: a
set -u

STACK="${1:-a}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT="$(mktemp -d)"
SUMMARY="$OUT/summary.txt"

eval "$(bash scripts/tutorials/stack.sh env "$STACK")"

# The staff login throttles at 5 per 15 minutes and EVERY attempt re-arms
# the window, so thirty back-to-back seed runs cascade into instant 429s
# and every world after the fifth fails for a reason that has nothing to
# do with seeding. Cleared before each run rather than hoped about.
clear_throttle() {
  node -e "const m = await import('./scripts/tutorials/lib/clear-login-throttle.mjs'); await m.clearLoginThrottle({ log: () => {} });" \
    --input-type=module >/dev/null 2>&1 || true
}

# Each entry owns at least one screen the admin video visits.
SLUGS=(
  book-the-van                     # pickups: the failed request and "Free the day"
  inspect-and-finalise-a-return    # the returns bench
  correct-a-count                  # a PENDING stock adjustment
  count-the-shelves                # an IN_PROGRESS cycle count with variances
  moving-stock-between-warehouses  # ADJUSTMENT_DECREASE movements
  when-nobody-will-carry-it        # the manual-placement queue
  acting-on-a-failed-delivery      # re-attempt and return-to-us requests
  is-the-courier-healthy           # the Delhivery ops panels
  courier-accounts-and-credentials # courier accounts and the default flag
  letting-a-seller-in              # a NEW invite lead
  managing-a-seller                # the client profile, holds and suspend
  per-seller-settings              # per-seller setting overrides
  change-a-system-setting          # the settings list
  staff-and-broadcasts             # staff rows and the broadcast composer
  what-we-cannot-undo              # an open bank-change request
  collapse-the-shelves             # a bin-collapse backup to restore
  refunds-and-disputes             # the STORE_DISPUTE ticket
  what-the-freight-cost            # inbound freight rows
  bill-the-freight                 # a COMPLETED arrival to bill
  how-seller-money-works           # wallet ledger shape
  accept-a-top-up                  # a PENDING top-up claim
  pay-a-seller-out                 # an APPROVED withdrawal
  approve-a-bank-change
  record-a-courier-payout          # settlement float
  move-money-by-hand               # wallet transfers
  the-bank-book                    # treasury accounts and movements
  take-money-out                   # a PENDING withdrawal
  where-is-my-parcel               # D0 lifecycle orders
)

# ── RAISED BEFORE THE MONEY WORLDS, NOT AFTER ────────────────────────
# `wallet.withdrawal_max_per_day` is seeded 1 and the server counts
# REQUESTS in the last 24h, so the second money world to ask for one is
# refused WITHDRAWAL_DAILY_LIMIT_REACHED. The admin video needs two in
# different states at once — a PENDING one for the withdrawals queue and
# an APPROVED one for the remittance screen.
#
# It has to happen HERE rather than inside the admin video's own seed,
# which runs last: `pay-a-seller-out` is refused long before that, and
# raising the limit afterwards fixes nothing. Filming stack only — the
# seeder refuses to run against anything else.
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const r = await p.systemSetting.updateMany({
    where: { key: 'wallet.withdrawal_max_per_day', valueInt: { lt: 5 } },
    data: { valueInt: 5 },
  });
  if (r.count > 0) console.log('  withdrawal daily limit raised to 5 for the union');
  await p.\$disconnect();
})();
" >/dev/null 2>&1 || true

: > "$SUMMARY"
for slug in "${SLUGS[@]}"; do
  clear_throttle
  timeout 600 node scripts/tutorials/seed-demo-data.mjs "$slug" > "$OUT/$slug.log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    printf 'OK    %-34s\n' "$slug" >> "$SUMMARY"
  else
    printf 'FAIL  %-34s exit=%s  %s\n' "$slug" "$code" \
      "$(grep -aoE '(Error:|→ [45][0-9][0-9]|Authentication failed).{0,90}' "$OUT/$slug.log" | head -1)" >> "$SUMMARY"
  fi
done

# LAST, and with --lifecycle: the D0 orders its own seed note names (the
# god-mode order, a DELIVERY_FAILED parcel with a live shipment, the
# returns journey) are gated behind that flag, not behind the slug.
clear_throttle
timeout 900 node scripts/tutorials/seed-demo-data.mjs admin-everything --lifecycle > "$OUT/admin.log" 2>&1
acode=$?
if [ "$acode" -eq 0 ]; then
  printf 'OK    %-34s (--lifecycle)\n' "admin-everything" >> "$SUMMARY"
else
  # Reported from the real exit code. An earlier version printed OK
  # unconditionally here and hid a 429 on the one run that matters most.
  printf 'FAIL  %-34s exit=%s  %s\n' "admin-everything" "$acode" \
    "$(grep -aoE '(Error:|→ [45][0-9][0-9]|Authentication failed).{0,90}' "$OUT/admin.log" | head -1)" >> "$SUMMARY"
fi

cat "$SUMMARY"
printf '\nlogs: %s\n' "$OUT"
grep -qa '^FAIL' "$SUMMARY" && exit 1
exit 0
