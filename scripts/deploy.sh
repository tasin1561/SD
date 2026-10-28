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
#   - pm2 restart EVERY app, because step 6 builds every app. The two
#     halves have to agree; see the long note above step 7 for what
#     happens when they do not.
#   - On any failure, exit non-zero so the workflow surfaces RED.
set -euo pipefail

ROOT="${HOME}/app"
cd "$ROOT"

# ── Re-exec from a snapshot, BEFORE the pull rewrites this file ───────
#
# bash reads a script by FILE OFFSET as it executes, not into memory. So
# `git pull` rewriting deploy.sh mid-run shifts every line after the
# pull, and bash carries on reading at the old byte position — executing
# fragments, or skipping whole lines, with no error.
#
# That is not theoretical. On 2026-09-01 the pull added `skydrop-portal`
# to the restart list; bash never executed that line, the deploy
# reported success, and the portal process sat on stale code for two
# hours while the API ran the new build.
#
# So: copy ourselves somewhere the pull cannot touch, and run THAT.
#
# The snapshot is taken BEFORE the pull, so a change to THIS FILE takes
# effect on the NEXT deploy, not the one carrying it. That is a real
# property and worth knowing — but it is a deterministic one-deploy lag
# rather than the undefined behaviour it replaces, and the alternative
# (pull, then re-exec the new copy) means duplicating the pull and its
# fail-fast handling outside the script that owns them.
if [ "${DEPLOY_REEXEC:-}" != "1" ]; then
  SNAPSHOT="$(mktemp /tmp/skydrop-deploy.XXXXXX.sh)"
  trap 'rm -f "$SNAPSHOT"' EXIT
  cp "$ROOT/scripts/deploy.sh" "$SNAPSHOT"
  DEPLOY_REEXEC=1 exec bash "$SNAPSHOT" "$@"
fi

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
# itself yields nothing — so the seed and the marketing publish below
# would both decide there was nothing to do, which is how a stale deploy
# survived a re-run.
#
# The build and the restart no longer consult this diff at all — both are
# unconditional (steps 6 and 7). It decides only whether to reseed and
# whether to re-publish the marketing export. An unknown marker (first
# run after this change, or a rewritten history) falls back to doing
# both. A wasted reseed costs seconds; a skipped one ships a screen whose
# dropdown is silently missing an option.
DIFF_BASE="$PRIOR_SHA"
if [ -n "$LAST_DEPLOYED" ] && git cat-file -e "${LAST_DEPLOYED}^{commit}" 2>/dev/null; then
  DIFF_BASE="$LAST_DEPLOYED"
elif [ -n "$LAST_DEPLOYED" ]; then
  echo "  marker names an unknown commit — reseeding + republishing."
  DIFF_BASE=""
fi

# What changed? (Cheap proxy: any file under each tree.) Read by the
# seed and the marketing publish, and by nothing else.
if [ -n "$DIFF_BASE" ] && [ "$DIFF_BASE" != "$NEW_SHA" ]; then
  CHANGED_FILES="$(git diff --name-only "$DIFF_BASE" "$NEW_SHA")"
else
  # No usable base: name every file so nothing is skipped.
  CHANGED_FILES="$(git ls-files apps packages)"
fi
# NB: `| head` under `set -o pipefail` SIGPIPEs (141) when the list is
# long — the `|| true` keeps the preview best-effort.
{ echo "$CHANGED_FILES" | head -20; } || true

did_change() { echo "$CHANGED_FILES" | grep -qE "$1"; }

# Marketing is a static export (output: 'export') served by Caddy from
# /var/www/skydrop-marketing — no pm2 process. Publish when it changes.
MARKETING_TOUCHED=false
did_change '^apps/marketing/|^packages/ui/' && MARKETING_TOUCHED=true

# Seed reruns when the seed, the schema, or any DATA the seed imports
# changes.
#
# The third clause is not padding: the Delhivery issue taxonomy lives in
# its own file, and matching only seed.ts would mean adding a category
# deploys the code that reads it and never the row itself — a dropdown
# that is silently missing an option nobody can find the cause of.
SEED_TOUCHED=false
did_change '^packages/db/prisma/seed\.ts$|^packages/db/prisma/schema\.prisma$|^packages/db/prisma/[a-z-]+\.ts$' && SEED_TOUCHED=true

# ── 2. What was shipped ──────────────────────────────────────────────
#
# THE DROPLET NO LONGER BUILDS ANYTHING (2026-10-28).
#
# It used to: `pnpm install` then ten `pnpm --filter ... build` calls,
# 12m35s on a 2-vCPU box, duplicating a build CI had already done and
# thrown away. It is also where apps/admin ran out of heap twice on
# 2026-10-27 and stopped the deploy dead.
#
# Now GitHub Actions builds, tars and uploads the outputs, and this
# script places them. What arrives:
#
#   $INCOMING/packages.tgz   every packages/*/dist (3.6 MB, always sent)
#   $INCOMING/<app>.tgz      that app's .next, or apps/api/dist
#   $INCOMING/marketing.tgz  apps/marketing/out, only when it changed
#
# Packages are sent WHOLE every time rather than per-affected. They are
# small, and the alternative is a shipped app running against a sibling
# package's older dist — a skew that typechecks locally and fails only
# in production.
INCOMING="$ROOT/.deploy-incoming/$EXPECTED_SHA"
APPS=("${@:2}")

# WORK IT OUT HERE when the caller did not say.
#
# The workflow used to compute this, which meant an SSH just to read the
# marker above — and connections are the scarce resource: `ufw limit`
# drops the 6th from one IP inside 30 seconds. Everything this needs is
# already in hand: the marker, the diff against it, and CHANGED_FILES.
# Asking the far end for a fact it is standing on was the wasteful part.
#
# The runner ships every app it built; this picks which to place. Over-
# shipping a few megabytes is cheaper than a second round trip, and far
# cheaper than getting the set wrong.
if [ ${#APPS[@]} -eq 0 ]; then
  for A in api admin seller track reseller associate marketing; do
    did_change "^apps/$A/" && APPS+=("$A")
  done
  # A shared surface reaches every app: packages, the lockfile, the root
  # configs. Erring wide costs seconds; erring narrow serves HTML naming
  # chunks that the build it was never given had deleted.
  if did_change '^(packages/|pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json|turbo\.json|tsconfig)'; then
    APPS=(api admin seller track reseller associate marketing)
    echo "── shared surface changed — every app ──"
  fi
fi

if [ ${#APPS[@]} -eq 0 ]; then
  echo "── nothing to deploy (no app changed since ${LAST_DEPLOYED:-<unknown>}) ──"
  echo "$NEW_SHA" > "$DEPLOYED_MARKER"
  rm -rf "$INCOMING"
  exit 0
fi
echo "── apps this deploy touches: ${APPS[*]} ──"

[ -d "$INCOMING" ] || { echo "no artifacts at $INCOMING"; exit 1; }

# ── 3. Install — ONLY when the lockfile moved ────────────────────────
#
# node_modules stays on the box. The shipped `.next` needs it at runtime
# (`next start` resolves from it) and so does apps/api/dist. Reinstalling
# when nothing moved cost ~90s for no change.
if did_change '^pnpm-lock\.yaml$'; then
  echo "── pnpm install (lockfile changed) ──"
  pnpm install --frozen-lockfile --prefer-offline
else
  echo "── lockfile unchanged — skipping install ──"
fi

# ── 4. Migrations — ONLY when a migration arrived ────────────────────
#
# `migrate deploy` is idempotent and costs ~2s, so this gate saves
# little. It is here because a deploy that does not touch the schema
# should not open a transaction against production at all.
if did_change '^packages/db/prisma/migrations/'; then
  echo "── prisma migrate deploy (migrations changed) ──"
  pnpm --filter @skydrop/db exec prisma migrate deploy
else
  echo "── no migrations in this change — skipping ──"
fi

# ── 5. Seed (idempotent, only when seed changed) ─────────────────────
if [ "$SEED_TOUCHED" = true ]; then
  echo "── reseed (seed.ts or schema.prisma touched) ──"
  pnpm --filter @skydrop/db seed
else
  echo "── seed unchanged — skipping ──"
fi

# ── 6. Place the artifacts: unpack beside, then swap ─────────────────
#
# NEVER unpack over a live directory. A half-written `.next` is served
# to whoever is on the site at that moment, and the failure looks like a
# corrupt build rather than a deploy in progress. Each output lands in a
# sibling `.incoming`, and the swap is two renames on the same
# filesystem — atomic enough that the window is sub-millisecond, and
# pm2 reload follows immediately.
#
# The previous output is KEPT as `.prev` for exactly one deploy, which
# is the whole rollback story until the release-directory scheme lands:
#     mv .next .next.bad && mv .next.prev .next && pm2 restart ...
swap_in() {           # $1 = live dir, $2 = tarball, $3 = label, $4 = proof file
  local live="$1" tgz="$2" label="$3" proof="$4"
  local inc="${live}.incoming" prev="${live}.prev"
  rm -rf "$inc"
  mkdir -p "$inc"
  tar -xzf "$tgz" -C "$inc"

  # PROVE the archive unpacked to the shape the app expects, BEFORE
  # anything live is touched. On 2026-10-28 the workflow archived the
  # output DIRECTORY instead of its contents, so `.next.incoming/.next/`
  # was swapped in as `.next/.next/` — a valid directory containing no
  # build. Nothing noticed until `next start` crash-looped and the
  # health check timed out 30 seconds later, by which point the live
  # build had already been replaced and had to be rolled back.
  #
  # One file is enough to tell a real build from a misshapen one, and
  # checking it here turns a confusing restart failure into a refusal
  # that never touches the running app.
  if [ ! -e "$inc/$proof" ]; then
    echo "  !! $label: archive has no $proof — refusing to swap"
    echo "     unpacked top level: $(ls -A "$inc" | head -5 | tr '\n' ' ')"
    rm -rf "$inc"
    return 1
  fi

  rm -rf "$prev"
  [ -e "$live" ] && mv "$live" "$prev"
  mv "$inc" "$live"
  echo "  placed $label (previous kept at $(basename "$prev"))"
}

echo "── place shared package builds ──"
tar -xzf "$INCOMING/packages.tgz" -C "$ROOT"

echo "── place app builds ──"
for APP in "${APPS[@]}"; do
  case "$APP" in
    api)       swap_in "$ROOT/apps/api/dist" "$INCOMING/api.tgz" "api/dist" "main.js" ;;
    marketing) : ;;  # static export, handled in 6b
    *)         swap_in "$ROOT/apps/$APP/.next" "$INCOMING/$APP.tgz" "$APP/.next" "BUILD_ID" ;;
  esac
done

# ── 6b. Publish marketing static export ─────────────────────────────
#
# apps/marketing is `output: 'export'` — no pm2 process, Caddy
# file-serves it.
#
# GATED ON THE DIFF, NOT ON THE TARBALL (2026-10-28). CI now packages
# all six apps on every run, because the browser job needs every app's
# output present to start its servers. So "the tarball was sent" stopped
# meaning "marketing changed" — and the publish below is an
# `rsync --delete` straight into the live directory, not an atomic
# swap. Running it on every unrelated deploy is a write window over the
# served site in exchange for nothing.
case " ${APPS[*]} " in
  *" marketing "*) MARKETING_CHANGED=true ;;
  *) MARKETING_CHANGED=false ;;
esac
if [ -f "$INCOMING/marketing.tgz" ] && [ "$MARKETING_CHANGED" = true ]; then
  echo "── publish marketing static ──"
  rm -rf "$ROOT/.marketing-out"
  mkdir -p "$ROOT/.marketing-out"
  tar -xzf "$INCOMING/marketing.tgz" -C "$ROOT/.marketing-out"
  sudo rsync -a --delete "$ROOT/.marketing-out/" /var/www/skydrop-marketing/
  sudo chown -R caddy:caddy /var/www/skydrop-marketing
  sudo chmod -R u=rwX,go=rX /var/www/skydrop-marketing
  rm -rf "$ROOT/.marketing-out"
else
  echo "── marketing unchanged — skipping publish ──"
fi

# ── 7. Restart — ONLY the apps this deploy touched ───────────────────
#
# TWO THINGS THAT LOOK OPTIONAL AND ARE NOT.
#
# (a) pm2 is handed the ECOSYSTEM FILE, never a bare process name.
#     `pm2 restart skydrop-api --update-env` refreshes a process from the
#     env of the pm2 CLI that invoked it, NOT from ~/app/.env — so a
#     newly added variable reaches nobody and the symptom is a feature
#     silently reading undefined. Naming the config file makes pm2
#     re-read it, and therefore the .env it loads. `--only` narrows WHICH
#     app restarts without giving up that re-read.
#
# (b) apps/api backs TWO processes: skydrop-api and skydrop-portal (the
#     courier-portal worker, same dist, different entrypoint). Restarting
#     one and not the other leaves the worker running yesterday's code
#     against today's database.
ECOSYSTEM="$ROOT/ecosystem.config.cjs"

pm2_names_for() {     # $1 = app key -> pm2 process name(s)
  case "$1" in
    api)       echo "skydrop-api skydrop-portal" ;;
    marketing) echo "" ;;                       # Caddy serves it; no process
    *)         echo "skydrop-$1" ;;
  esac
}

RESTART=()
for APP in "${APPS[@]}"; do
  for N in $(pm2_names_for "$APP"); do RESTART+=("$N"); done
done

if [ ${#RESTART[@]} -gt 0 ]; then
  ONLY=$(IFS=,; echo "${RESTART[*]}")
  echo "── pm2 restart (ecosystem re-read): $ONLY ──"
  pm2 restart "$ECOSYSTEM" --only "$ONLY" --update-env
  pm2 save
else
  echo "── no pm2 process to restart (marketing only) ──"
fi

# ── 8. Health smoke — the apps we just moved ─────────────────────────
#
# pm2 returns the moment the process is SPAWNED, which is well before
# Next has compiled its first route. The retry loop is the difference
# between "restarted" and "serving".
declare -A PORT=( [admin]=3002 [seller]=3003 [track]=3004 [reseller]=3005 [associate]=3007 )

check_url() {
  local url="$1" code
  for _ in $(seq 1 15); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$url" 2>/dev/null || echo "000")
    if [[ "$code" == 2* || "$code" == 3* ]]; then echo "  $url → $code"; return 0; fi
    sleep 2
  done
  echo "  ✗ $url unhealthy after 30s (last status: $code)"
  return 1
}

echo "── health smoke ──"
FAILED=()
for APP in "${APPS[@]}"; do
  case "$APP" in
    api)
      check_url "http://127.0.0.1:4000/health" || FAILED+=("api")
      ;;
    marketing)
      check_url "http://127.0.0.1/" || true   # Caddy, not pm2
      ;;
    *)
      P="${PORT[$APP]:-}"
      [ -n "$P" ] && { check_url "http://127.0.0.1:$P/login" || FAILED+=("$APP"); }
      ;;
  esac
done

# ── 9. Roll back anything that did not come up ───────────────────────
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "!! unhealthy after deploy: ${FAILED[*]} — rolling those back"
  for APP in "${FAILED[@]}"; do
    LIVE="$ROOT/apps/$APP/.next"; [ "$APP" = "api" ] && LIVE="$ROOT/apps/api/dist"
    if [ -d "${LIVE}.prev" ]; then
      rm -rf "${LIVE}.bad"; mv "$LIVE" "${LIVE}.bad"; mv "${LIVE}.prev" "$LIVE"
      echo "  rolled $APP back to its previous build"
    else
      echo "  !! no previous build kept for $APP — cannot roll back"
    fi
    for N in $(pm2_names_for "$APP"); do
      pm2 restart "$ECOSYSTEM" --only "$N" --update-env || true
    done
  done
  echo "!! deploy FAILED; the marker is NOT advanced."
  exit 1
fi

# ── 10. The marker, written LAST ─────────────────────────────────────
#
# It means "this SHA built, placed, restarted AND answered". Written any
# earlier it would mean "git reached this SHA", which on 2026-08-31 let a
# crashed deploy report success and every re-run skip the work.
echo "$NEW_SHA" > "$DEPLOYED_MARKER"
rm -rf "$INCOMING"
echo "=== Deploy OK: ${LAST_DEPLOYED:-<unknown>} → $NEW_SHA (${APPS[*]}) ==="
