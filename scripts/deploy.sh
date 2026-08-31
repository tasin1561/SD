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

# What was last BUILT AND STARTED, which is a different fact from what
# git is checked out at.
#
# A deploy that pulls and then dies in the build — the box ran out of
# memory on 2026-08-31 and had to be power-cycled — leaves the repo at
# the target SHA with yesterday's `dist/`. Comparing git-HEAD against
# git-HEAD then said "no change; skipping build + restart" and exited
# 0, so the deploy reported SUCCESS while production ran stale code,
# and every re-run did the same. Nothing short of a new commit could
# break the loop, and nothing anywhere said so.
#
# The marker is written LAST, after the build, the restart and the
# health checks have all passed, so its presence means those happened.
DEPLOYED_MARKER="$ROOT/.last-deployed-sha"
LAST_DEPLOYED="$(cat "$DEPLOYED_MARKER" 2>/dev/null || true)"

echo "=== Deploy starting ==="
echo "  cwd:     $(pwd)"
echo "  prior:   $PRIOR_SHA"
echo "  built:   ${LAST_DEPLOYED:-<unknown — will rebuild>}"
[ -n "$EXPECTED_SHA" ] && echo "  target:  $EXPECTED_SHA"

# ── 1. Pull ──────────────────────────────────────────────────────────
echo "── git pull ──"
git fetch --quiet origin main
git merge --ff-only origin/main
NEW_SHA="$(git rev-parse HEAD)"
echo "  now at:  $NEW_SHA"
if [ "$NEW_SHA" = "$LAST_DEPLOYED" ]; then
  echo "  already built and running this commit; nothing to do."
  exit 0
fi

# Diff against what is RUNNING, not against where git happened to be.
# After a crashed deploy those are different, and diffing HEAD against
# itself yields nothing — so the per-app change detection below would
# decide that no app needs rebuilding, which is how the stale build
# survived a re-run.
#
# An unknown marker (first run after this change, or a rewritten
# history) falls back to rebuilding everything. A wasted build costs
# minutes; a skipped one costs an outage nobody can see.
DIFF_BASE="$PRIOR_SHA"
if [ -n "$LAST_DEPLOYED" ] && git cat-file -e "${LAST_DEPLOYED}^{commit}" 2>/dev/null; then
  DIFF_BASE="$LAST_DEPLOYED"
elif [ -n "$LAST_DEPLOYED" ]; then
  echo "  marker names an unknown commit — rebuilding everything."
  DIFF_BASE=""
fi

# Which apps changed? (Cheap proxy: any file under each app/ tree.)
if [ -n "$DIFF_BASE" ] && [ "$DIFF_BASE" != "$NEW_SHA" ]; then
  CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" "$NEW_SHA")"
else
  # No usable base: name every app so nothing is skipped.
  CHANGED_FILES="$(git ls-files apps packages)"
fi
# NB: `| head` under `set -o pipefail` SIGPIPEs (141) when the list is
# long — the `|| true` keeps the preview best-effort.
{ echo "$CHANGED_FILES" | head -20; } || true

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

# Marketing is a static export (output: 'export') served by Caddy from
# /var/www/skydrop-marketing — no pm2 process. Publish when it changes.
MARKETING_TOUCHED=false
did_change '^apps/marketing/|^packages/ui/' && MARKETING_TOUCHED=true

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
pnpm --filter @skydrop/marketing build

# ── 6b. Publish marketing static export ─────────────────────────────
if [ "$MARKETING_TOUCHED" = true ]; then
  echo "── publish marketing static ──"
  sudo rsync -a --delete apps/marketing/out/ /var/www/skydrop-marketing/
  sudo chown -R caddy:caddy /var/www/skydrop-marketing
  sudo chmod -R u=rwX,go=rX /var/www/skydrop-marketing
else
  echo "── marketing unchanged — skipping publish ──"
fi

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
# pm2 restart returns the moment the new process is spawned, but the
# Next.js servers take ~3-10s to actually bind their port. Poll each
# URL up to ~30s before giving up.
echo "── health smoke ──"
check_url() {
  local url="$1"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
    if [[ "$code" == 2* || "$code" == 3* ]]; then
      echo "  $url → $code"
      return 0
    fi
    sleep 2
  done
  echo "  ✗ $url unhealthy after 30s (last status: $code)"
  return 1
}

for url in \
  http://127.0.0.1:4000/health \
  http://127.0.0.1:3002/login \
  http://127.0.0.1:3003/login \
  http://127.0.0.1:3004/; do
  check_url "$url" || exit 1
done

# Only NOW is this commit genuinely deployed: built, restarted, and
# answering on every port. Written last on purpose — a marker written
# earlier would claim a deploy that a later step could still fail.
echo "$NEW_SHA" > "$DEPLOYED_MARKER"

echo
echo "=== Deploy OK: ${DIFF_BASE:-<full rebuild>} → $NEW_SHA ==="
