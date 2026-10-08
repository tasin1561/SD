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
pnpm --filter @skydrop/reseller build
# ASSOC-1 — the associate portal. In the build list EVERY deploy, like
# every other app: step 7 restarts all of them unconditionally, and the
# two halves have to agree or a restarted process serves HTML naming
# chunks the build it was not given deleted.
pnpm --filter @skydrop/associate build
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
# EVERY app, EVERY deploy — because step 6 BUILDS every app, every
# deploy. The two halves have to agree.
#
# `next build` wipes and regenerates `.next`, and Next names its chunks
# by content hash. So any rebuild whose output differs — a change to
# code the app imports from packages/*, a dependency bump, anything at
# all — writes NEW chunk filenames and DELETES the old ones. A running
# `next start` holds the old build's manifests in memory and carries on
# serving HTML that names files no longer on disk: every script tag
# 400s, nothing hydrates, and the person looking at it sees a skeleton
# that never resolves.
#
# And it is SILENT. The deploy reports success, pm2 says `online`, and
# the health smoke passes, because the server really is serving its HTML
# perfectly well. Measured on 2026-09-27: skydrop-reseller was last
# started 10:09 UTC, every app was rebuilt 14:48–14:52 UTC, and
# reseller.skydrop.global served HTML referencing
# webpack-9a474f8fde7c98c0.js while the disk held
# webpack-ad10e0c6e958d305.js. The store portal had been unusable for
# about five hours; a manual restart fixed it, which is what confirmed
# the mechanism. The same sweep found skydrop-admin broken the same way
# on the same afternoon — so it is not a one-off, and nobody had noticed
# either of them.
#
# What this replaced was a per-app restart list (APPS_CHANGED /
# PKG_TOUCHED) that restarted only the apps whose own tree had changed,
# with a hand-maintained table of which package fans out to which app.
# That table is the thing that rots, and its failure mode is exactly the
# silent breakage above. Teaching the RESTART about the dependency graph
# is a harder problem than the one it solves; making it match the BUILD
# is one line. If selective restarts are ever wanted back, make the
# BUILD selective first — step 6 is what decides which apps are at risk.
#
# Step 8 now also fetches one `/_next/static/*.js` per app off the page
# that names it, so a recurrence of this fails the deploy instead of
# waiting for somebody to notice a dead screen.
#
# RESTART THROUGH THE ECOSYSTEM FILE, not by process name. `--update-env`
# refreshes a process from the env of the pm2 CLI that invoked it; it
# does NOT re-evaluate ecosystem.config.cjs, and that file is the thing
# that reads ~/app/.env. So `pm2 restart skydrop-api --update-env`
# delivers a new .env variable to nobody — the process keeps the env it
# was originally started with, and the symptom is a feature that behaves
# as if its secret were empty while the secret is plainly there in the
# file. Verified on 2026-09-09: TRACKING_WEBHOOK_SECRET_SHIPROCKET was
# appended to .env and was still ABSENT from the running process after a
# deploy.
#
# Naming the config file makes pm2 re-read it (and therefore .env) and
# apply the result.
ECOSYSTEM="$ROOT/ecosystem.config.cjs"
echo "── pm2 restart all (ecosystem re-read) ──"
pm2 restart "$ECOSYSTEM" --update-env

pm2 save

# ── 8. Health smoke ──────────────────────────────────────────────────
# pm2 restart returns the moment the new process is spawned, but the
# Next.js servers take ~3-10s to actually bind their port. Poll each
# URL up to ~30s before giving up.
#
# `/health` answers 503 — not 200 with a "degraded" body — when the API
# cannot reach Postgres or Redis. So this smoke now FAILS the deploy on
# an API that came up but cannot serve a request, instead of reporting
# success and writing .last-deployed-sha. That is deliberate: the 30s of
# retries cover a slow first connection, and anything still degraded
# after them is a broken deploy, not a slow one.
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

# A Next app serves its HTML perfectly while every script tag on it 400s
# — that is the stale-process failure step 7 describes, and `check_url`
# is structurally unable to see it, because the HTML is fine. It is the
# chunks the HTML NAMES that are gone. So: read the page, pull one
# `/_next/static/*.js` URL out of it, and fetch that too.
#
# Deliberately NOT a timestamp comparison (process start vs `.next`
# mtime). Measured 2026-09-27: skydrop-track's process was 4.7 hours
# older than its own build and was serving perfectly, because that
# rebuild happened to produce identical chunk names — so the age test
# reports false alarms, and a check that cries wolf is one
# people route around. Ask the bytes: does the file this page names
# actually load?
check_next_chunk() {
  local base="$1" page="$2"
  local asset code ctype
  # `|| true`: grep exits 1 on no match and would sink the whole pipeline
  # under `set -o pipefail`. `sed -n 1p` rather than `head -1`, which
  # SIGPIPEs the grep feeding it (141) — same trap as the diff preview.
  asset=$(curl -s --max-time 5 "$base$page" 2>/dev/null \
    | grep -o '/_next/static/[A-Za-z0-9._/-]*\.js' \
    | sed -n '1p' || true)
  if [ -z "$asset" ]; then
    # Not the failure we are looking for — a page that names no chunk is
    # odd, not broken. Say so and move on rather than block the deploy.
    echo "  ? $base$page names no /_next/static/*.js — chunk check skipped"
    return 0
  fi
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$base$asset" 2>/dev/null || echo "000")
  ctype=$(curl -s -o /dev/null -w "%{content_type}" --max-time 5 "$base$asset" 2>/dev/null || echo "")
  if [[ "$code" == 2* ]] && [[ "$ctype" == *javascript* ]]; then
    echo "  $base$asset → $code"
    return 0
  fi
  echo "  ✗ $base$page is serving STALE HTML."
  echo "    It names $asset, which answers $code${ctype:+ ($ctype)}."
  echo "    The running process is older than the build on disk: the chunk"
  echo "    filenames it hands out no longer exist, so the page loads and"
  echo "    then never hydrates. Restart it —"
  echo "      pm2 restart $ECOSYSTEM --update-env"
  return 1
}

for url in \
  http://127.0.0.1:4000/health \
  http://127.0.0.1:3002/login \
  http://127.0.0.1:3003/login \
  http://127.0.0.1:3004/; do
  check_url "$url" || exit 1
done

# Next apps only — the API serves no chunks.
check_next_chunk http://127.0.0.1:3002 /login || exit 1
check_next_chunk http://127.0.0.1:3003 /login || exit 1
check_next_chunk http://127.0.0.1:3004 / || exit 1

# ASSOC-1 — the associate portal, polled only once pm2 knows it, for the
# same reason as the reseller one below: its first start is a manual
# `pm2 start ecosystem.config.cjs --only skydrop-associate && pm2 save`,
# and until that has happened a missing process must not fail the deploy
# that is building the app it needs.
if pm2 jlist 2>/dev/null | grep -q '"name":"skydrop-associate"'; then
  check_url http://127.0.0.1:3007/login || exit 1
  check_next_chunk http://127.0.0.1:3007 /login || exit 1
else
  echo "  skydrop-associate not registered with pm2 yet — skipping its health check"
fi

# RS-12 — the reseller portal is polled only once pm2 knows it. Its first
# start is an owner step on the droplet (`pm2 start ecosystem.config.cjs
# --only skydrop-reseller && pm2 save`); until then a missing process
# must not fail every deploy for a reason the deploy did not cause.
if pm2 jlist 2>/dev/null | grep -q '"name":"skydrop-reseller"'; then
  check_url http://127.0.0.1:3005/login || exit 1
  check_next_chunk http://127.0.0.1:3005 /login || exit 1
else
  echo "  skydrop-reseller not registered with pm2 yet — skipping its health check"
fi

# The portal worker has no port to poll — it is a browser, not a server.
# So it is checked the only way it can be: pm2 says it is online and has
# stayed that way. Without this a crash-loop would be invisible, since
# nothing ever talks to it and its whole job happens at 02:40.
if pm2 jlist 2>/dev/null | grep -q '"name":"skydrop-portal"'; then
  sleep 5
  PORTAL_STATUS=$(pm2 jlist 2>/dev/null \
    | python3 -c "import sys,json;print(next((p['pm2_env']['status'] for p in json.load(sys.stdin) if p['name']=='skydrop-portal'),'missing'))" 2>/dev/null || echo unknown)
  if [ "$PORTAL_STATUS" = "online" ]; then
    echo "  skydrop-portal → online"
  else
    echo "  ✗ skydrop-portal is $PORTAL_STATUS"
    exit 1
  fi
fi

# Only NOW is this commit genuinely deployed: built, restarted, and
# answering on every port. Written last on purpose — a marker written
# earlier would claim a deploy that a later step could still fail.
echo "$NEW_SHA" > "$DEPLOYED_MARKER"

echo
echo "=== Deploy OK: ${DIFF_BASE:-<full rebuild>} → $NEW_SHA ==="
