#!/usr/bin/env bash
# Skydrop off-site backup — the database, every stored file and the server's
# secrets, copied to Google Drive ENCRYPTED. Runs from cron on the droplet
# every two hours (:10 past each even hour, UTC) as the `skydrop` user. Recovery: docs/disaster-recovery.md.
#
#   db/YYYY/MM/defaultdb-<ts>.dump   pg_dump custom format (pg_restore reads it)
#   secrets/YYYY/MM/secrets-<ts>.tar.gz   .env, Caddyfile, pm2 config, crontab
#   files/current/                   a mirror of the Spaces bucket
#   files/changed/<ts>/              what that run overwrote or deleted there
#
# Everything is written through the rclone `crypt` remote, so Google holds
# ciphertext only. The passphrase lives in ~/.config/skydrop-backup/passphrase
# on the server and with the owner OFF Google — without it nothing here opens.
#
# Every run records `system.backup.completed` or `system.backup.failed` in
# audit_logs; the API's backup watchdog raises an issue when the latest run
# failed or no run has succeeded for too long. A silent stop is the failure
# this is built to make impossible.
#
# The body is one function called on the last line, so bash has read the
# whole file before running any of it — a deploy that rewrites this file
# mid-run cannot splice two versions together.
set -Eeuo pipefail
umask 077
# The recorder sits beside this script, wherever the two were copied.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

main() {
  # Globals, not locals: the EXIT trap runs after main has returned.
  app="$HOME/app"
  local conf="$HOME/.config/skydrop-backup"
  local state="$HOME/.local/state/skydrop-backup"
  local rclone="$HOME/.local/bin/rclone"
  local pg_bin="/usr/lib/postgresql/18/bin"
  local remote="skydrop-backup:"
  local ts month
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  month="$(date -u +%Y/%m)"
  started="$(date +%s)"
  mkdir -p "$state"
  log="$state/backup.log"
  exec 9>"$state/lock"
  if ! flock -n 9; then
    echo "$(date -Is) another backup is still running; this run skipped" >>"$log"
    return 0
  fi
  work="$(mktemp -d /tmp/skydrop-backup.XXXXXX)"

  STEP="start"
  DB_BYTES=0
  SECRETS_BYTES=0
  FILES_SUMMARY=""
  trap 'on_exit $?' EXIT

  local -a rc_flags=(--contimeout 30s --timeout 10m --retries 3 --low-level-retries 10 --log-level NOTICE --log-file "$log")

  # ── 1. Database ────────────────────────────────────────────────────
  STEP="database dump"
  local db_url
  db_url="$(env_value DATABASE_URL "$app/.env")"
  # Prisma-only query parameters (connection_limit, schema, …) are not
  # libpq's; keep the address and require TLS.
  db_url="${db_url%%\?*}?sslmode=require"
  local dump="$work/defaultdb-$ts.dump"
  "$pg_bin/pg_dump" --format=custom --compress=6 --no-owner --no-privileges \
    --dbname="$db_url" --file="$dump" 2>>"$log"
  # A dump that pg_restore cannot list is not a backup.
  "$pg_bin/pg_restore" --list "$dump" >/dev/null
  DB_BYTES="$(stat -c %s "$dump")"

  STEP="database upload"
  "$rclone" copyto "$dump" "${remote}db/$month/defaultdb-$ts.dump" "${rc_flags[@]}"
  verify_upload "$rclone" "$dump" "${remote}db/$month/defaultdb-$ts.dump"

  # ── 2. Secrets and server settings ────────────────────────────────
  STEP="secrets"
  local bundle="$work/secrets-$ts.tar.gz"
  crontab -l >"$work/crontab.txt" 2>/dev/null || true
  local -a secret_files=("$app/.env" "$app/ecosystem.config.cjs" "$work/crontab.txt")
  local f
  # The web server, the pm2 boot unit, the Shiprocket egress tunnel and the
  # VPC route, plus the key that opens the tunnel — what a rebuilt server
  # needs besides the code in git.
  for f in /etc/caddy/Caddyfile \
    /etc/systemd/system/pm2-skydrop.service \
    /etc/systemd/system/shiprocket-egress-tunnel.service \
    /etc/systemd/system/vpc-peering.service \
    /var/lib/cloud/scripts/peering.sh \
    "$HOME/.ssh/id_ed25519" "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/known_hosts" \
    "$HOME/.ssh/authorized_keys" "$HOME/verify/verify-run.cjs"; do
    [ -r "$f" ] && secret_files+=("$f")
  done

  # The India egress droplet (Bangalore) holds almost nothing — who may log
  # in, sshd and firewall settings, DigitalOcean's peering route — but a
  # rebuilt one must match. Its address is config, not code.
  STEP="india egress settings"
  if [ -r "$conf/india-host" ]; then
    local india
    india="$(tr -d '[:space:]' <"$conf/india-host")"
    ssh -o BatchMode=yes -o ConnectTimeout=20 "$india" \
      'tar -czf - --absolute-names --ignore-failed-read /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys /etc/ssh/sshd_config /etc/ssh/sshd_config.d /etc/ufw /etc/systemd/system/vpc-peering.service /var/lib/cloud/scripts/peering.sh 2>/dev/null' \
      >"$work/india-egress.tar.gz" 2>>"$log"
    # An empty archive means the droplet answered nothing useful.
    [ "$(tar -tzf "$work/india-egress.tar.gz" | wc -l)" -gt 0 ]
    secret_files+=("$work/india-egress.tar.gz")
  fi

  STEP="secrets"
  tar -czf "$bundle" --absolute-names "${secret_files[@]}" 2>>"$log"
  SECRETS_BYTES="$(stat -c %s "$bundle")"
  "$rclone" copyto "$bundle" "${remote}secrets/$month/secrets-$ts.tar.gz" "${rc_flags[@]}"
  verify_upload "$rclone" "$bundle" "${remote}secrets/$month/secrets-$ts.tar.gz"

  # ── 3. Stored files (DigitalOcean Spaces) ─────────────────────────
  STEP="stored files"
  local endpoint
  endpoint="$(env_value SPACES_ENDPOINT "$app/.env")"
  export RCLONE_S3_PROVIDER=DigitalOcean
  export RCLONE_S3_ENDPOINT="${endpoint#https://}"
  RCLONE_S3_ACCESS_KEY_ID="$(env_value SPACES_ACCESS_KEY_ID "$app/.env")"
  RCLONE_S3_SECRET_ACCESS_KEY="$(env_value SPACES_SECRET_ACCESS_KEY "$app/.env")"
  RCLONE_S3_REGION="$(env_value SPACES_REGION "$app/.env")"
  export RCLONE_S3_ACCESS_KEY_ID RCLONE_S3_SECRET_ACCESS_KEY RCLONE_S3_REGION
  local bucket
  bucket="$(env_value SPACES_BUCKET "$app/.env")"
  # Overwritten or deleted objects move to files/changed/<ts>, never away.
  "$rclone" sync ":s3:$bucket" "${remote}files/current" \
    --backup-dir "${remote}files/changed/$ts" --stats-one-line --stats-log-level NOTICE \
    "${rc_flags[@]}"
  FILES_SUMMARY="$("$rclone" size "${remote}files/current" --json 2>/dev/null || echo '{}')"

  # ── 4. Retention ──────────────────────────────────────────────────
  STEP="retention"
  prune "$rclone" "${remote}db" "${rc_flags[@]}"
  prune "$rclone" "${remote}secrets" "${rc_flags[@]}"
  # files/changed only exists once a run has overwritten or deleted something.
  if "$rclone" lsf "${remote}files/" 2>/dev/null | grep -qx 'changed/'; then
    "$rclone" delete "${remote}files/changed" --min-age 180d "${rc_flags[@]}" || true
    "$rclone" rmdirs "${remote}files/changed" --leave-root "${rc_flags[@]}" || true
  fi

  STEP="done"
}

# The value of KEY in an env file, quotes stripped. Never echoed to a log.
env_value() {
  local line
  line="$(grep -m1 -E "^$1=" "$2" || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  if [ -z "$line" ]; then
    echo "missing $1 in $2" >&2
    return 1
  fi
  printf '%s' "$line"
}

# Read the uploaded copy back and compare it byte for byte (sha256).
verify_upload() {
  local rclone="$1" local_file="$2" remote_path="$3" want got
  want="$(sha256sum "$local_file" | cut -d' ' -f1)"
  got="$("$rclone" cat "$remote_path" | sha256sum | cut -d' ' -f1)"
  if [ "$want" != "$got" ]; then
    echo "uploaded copy of $(basename "$local_file") does not match the original" >&2
    return 1
  fi
}

# Keep: everything from the last 7 days; the newest per day for 30 days,
# per ISO week for 12 weeks, per month for 24 months; and always the newest 4.
prune() {
  local rclone="$1" base="$2"
  shift 2
  local listing doomed
  listing="$("$rclone" lsf -R --files-only "$base" 2>/dev/null || true)"
  [ -z "$listing" ] && return 0
  doomed="$(printf '%s\n' "$listing" | python3 -c '
import re, sys, datetime as dt
now = dt.datetime.now(dt.timezone.utc)
items = []
for line in sys.stdin:
    p = line.strip()
    m = re.search(r"(\d{8}T\d{6}Z)", p)
    if not m:
        continue
    t = dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    items.append((t, p))
items.sort(reverse=True)
keep = {p for _, p in items[:4]}
seen = {"d": set(), "w": set(), "m": set()}
for t, p in items:
    age = (now - t).days
    if age <= 7:
        keep.add(p)
    for k, key, limit in (("d", t.strftime("%Y-%m-%d"), 30),
                          ("w", "%d-%02d" % t.isocalendar()[:2], 84),
                          ("m", t.strftime("%Y-%m"), 730)):
        if age <= limit and key not in seen[k]:
            seen[k].add(key)
            keep.add(p)
for _, p in items:
    if p not in keep:
        print(p)
')"
  [ -z "$doomed" ] && return 0
  while IFS= read -r path; do
    [ -n "$path" ] && "$rclone" deletefile "$base/$path" "$@"
  done <<<"$doomed"
}

on_exit() {
  local rc="$1"
  rm -rf "$work"
  local outcome="completed"
  [ "$rc" -ne 0 ] && outcome="failed"
  local finished duration meta
  finished="$(date +%s)"
  duration=$((finished - started))
  meta="$(python3 -c '
import json, sys
files = sys.argv[6]
try:
    files = json.loads(files) if files else {}
except ValueError:
    files = {}
print(json.dumps({
    "step": sys.argv[1], "exitCode": int(sys.argv[2]),
    "durationSeconds": int(sys.argv[3]),
    "databaseDumpBytes": int(sys.argv[4]), "secretsBytes": int(sys.argv[5]),
    "storedFiles": files.get("count"), "storedFileBytes": files.get("bytes"),
    "host": sys.argv[7],
}))' "$STEP" "$rc" "$duration" "$DB_BYTES" "$SECRETS_BYTES" "$FILES_SUMMARY" "$(hostname)")"
  echo "$(date -Is) $outcome step=$STEP seconds=$duration" >>"$log"
  (cd "$app/packages/db" && node "$SCRIPT_DIR/record-backup-run.cjs" "$outcome" "$meta") >>"$log" 2>&1 ||
    echo "$(date -Is) could not record the run in audit_logs" >>"$log"
  # Keep the log bounded.
  tail -n 5000 "$log" >"$log.tmp" 2>/dev/null && mv "$log.tmp" "$log"
}

main "$@"
