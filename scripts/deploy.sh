#!/usr/bin/env bash
# Production deploy script. Runs ON the droplet.
#
# Triggered by .github/workflows/deploy.yml after CI passes on `main`.
# Can also be run manually:  ssh skydrop bash ~/app/scripts/deploy.sh
#
# Discipline:
#   - Pull main, fail-fast on any non-fast-forward.
#   - Install with the frozen lockfile (matches CI).
#   - Build packages first (apps depend on dist), then the four apps.
#   - Run prisma migrate deploy (no-op if no new migrations).
#   - Run prisma db seed (idempotent — every upsert keyed on a unique
#     constraint, see packages/db/prisma/seed.ts).
#   - pm2 restart only the apps whose code actually changed. Falls
#     back to all-four-restart if we can't compute a diff.
#   - On any failure, exit non-zero so the workflow surfaces RED.
set -euo pipefail

ROOT="${HOME}/app"
cd "$ROOT"

EXPECTED_SHA="${1:-}"  # passed from the workflow for sanity logging
PRIOR_SHA="$(git rev-parse HEAD)"

echo "=== Deploy starting ==="
echo "  cwd:     $(pwd)"
echo "  prior:   $PRIOR_SHA"
[ -n "$EXPECTED_SHA" ] && echo "  target:  $EXPECTED_SHA"

# ── 1. Pull ──────────────────────────────────────────────────────────
echo "── git pull ──"
git fetch --quiet origin main
git merge --ff-only origin/main
NEW_SHA="$(git rev-parse HEAD)"
echo "  now at:  $NEW_SHA"
if [ "$PRIOR_SHA" = "$NEW_SHA" ]; then
  echo "  no change; skipping build + restart."
  exit 0
fi

# Which apps changed? (Cheap proxy: any file under each app/ tree.)
CHANGED_FILES="$(git diff --name-only "$PRIOR_SHA" "$NEW_SHA")"
echo "$CHANGED_FILES" | head -20

did_change() { echo "$CHANGED_FILES" | grep -qE "$1"; }

# Packages most apps depend on transitively — always rebuild + restart
# everything when any of these change.
PKG_TOUCHED=false
if did_change '^packages/(db|api-client|auth|ui)/'; then
  PKG_TOUCHED=true
fi

# Per-app dirty bits
APPS_CHANGED=()
did_change '^packages/(db|api-client|auth)/'                       && APPS_CHANGED+=(skydrop-api skydrop-admin skydrop-seller skydrop-track)
did_change '^packages/ui/'                                         && APPS_CHANGED+=(skydrop-admin skydrop-seller skydrop-track)
did_change '^apps/api/'                                            && APPS_CHANGED+=(skydrop-api)
did_change '^apps/admin/'                                          && APPS_CHANGED+=(skydrop-admin)
did_change '^apps/seller/'                                         && APPS_CHANGED+=(skydrop-seller)
did_change '^apps/track/'                                          && APPS_CHANGED+=(skydrop-track)
# de-dup
APPS_CHANGED=($(printf '%s\n' "${APPS_CHANGED[@]:-}" | awk 'NF' | sort -u))

# Seed reruns when seed file or schema change
SEED_TOUCHED=false
did_change '^packages/db/prisma/seed\.ts$|^packages/db/prisma/schema\.prisma$' && SEED_TOUCHED=true

# ── 2. Install ───────────────────────────────────────────────────────
echo "── pnpm install ──"
pnpm install --frozen-lockfile

# ── 3. Build packages ────────────────────────────────────────────────
echo "── build packages ──"
pnpm --filter @skydrop/db build
pnpm --filter @skydrop/api-client build
pnpm --filter @skydrop/ui build

# ── 4. Migrations ────────────────────────────────────────────────────
echo "── prisma migrate deploy ──"
pnpm --filter @skydrop/db exec prisma migrate deploy

# ── 5. Seed (idempotent, only when seed changed) ─────────────────────
if [ "$SEED_TOUCHED" = true ]; then
  echo "── reseed (seed.ts or schema.prisma touched) ──"
  pnpm --filter @skydrop/db seed
else
  echo "── seed unchanged — skipping ──"
fi

# ── 6. Build apps ────────────────────────────────────────────────────
echo "── build apps ──"
pnpm --filter @skydrop/api build
pnpm --filter @skydrop/admin build
pnpm --filter @skydrop/seller build
pnpm --filter @skydrop/track build

# ── 7. Restart pm2 ───────────────────────────────────────────────────
# If a shared package changed, restart everything; otherwise restart
# only the apps with code changes. Fall back to all-four if we can't
# tell.
if [ "$PKG_TOUCHED" = true ] || [ ${#APPS_CHANGED[@]} -eq 0 ]; then
  echo "── pm2 restart all ──"
  pm2 restart skydrop-api skydrop-admin skydrop-seller skydrop-track --update-env
else
  echo "── pm2 restart ${APPS_CHANGED[*]} ──"
  pm2 restart "${APPS_CHANGED[@]}" --update-env
fi

pm2 save

# ── 8. Health smoke ──────────────────────────────────────────────────
echo "── health smoke ──"
for url in \
  http://127.0.0.1:4000/health \
  http://127.0.0.1:3002/login \
  http://127.0.0.1:3003/login \
  http://127.0.0.1:3004/; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  echo "  $url → $code"
  [[ "$code" == 2* || "$code" == 3* ]] || { echo "  ✗ unhealthy"; exit 1; }
done

echo
echo "=== Deploy OK: $PRIOR_SHA → $NEW_SHA ==="
