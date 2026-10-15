#!/usr/bin/env bash
#
# Lay the whole video library out in folders somebody can hand over.
#
#   scripts/tutorials/deliver-library.sh            # into Windows Downloads
#   SKYDROP_DELIVER_DIR=/some/path  …               # somewhere else
#
# WHY FOLDERS BY CONSOLE. The library is 115 short videos and 12 long
# ones, and a flat directory of 127 files is not something anybody hands
# to a new member of staff. Each short video is filed under the CONSOLE
# it films — which is read from `FLOWS[slug].app`, never guessed from
# the slug, because the slug says what the video is about and the app
# says who needs to watch it ("accept-a-top-up" is admin; "take-money-
# out" is the client).
#
# The folder names are the PRODUCT's words (CON-2), not the code's:
# apps/seller films the CLIENT console, apps/reseller the MEMBER store
# portal. A folder called "seller" would be the one place in the
# handover still using the old vocabulary.
#
# A video is copied only when ffprobe can read a duration out of it.
# ffmpeg creates an mp4 and then writes into it for a minute or more, so
# a copy taken on first sight is a truncated file that plays for four
# seconds and looks like a broken render.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
SRC="$ROOT/scripts/tutorials/out"
DEST="${SKYDROP_DELIVER_DIR:-/mnt/c/Users/User/Downloads}/Skydrop tutorials"

# console key -> folder name a person reads
declare -A FOLDER=(
  [admin]="Admin — Skydrop staff"
  [seller]="Client console"
  [reseller]="Member store portal"
  [associate]="Associate (sales people)"
)

LONG_EN=(seller-everything reseller-everything associate-everything)
LONG_BN=(seller-everything-bn reseller-everything-bn associate-everything-bn)
LONG_HI=(seller-everything-hi reseller-everything-hi associate-everything-hi)
PROMOS=(promo-seller promo-reseller promo-associate)

playable() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" >/dev/null 2>&1; }

copied=0; missing=0; truncated=0
MISSING_LIST=""

place() { # slug, folder
  local slug="$1" dir="$2" src="$SRC/$1.mp4"
  if [ ! -f "$src" ]; then
    MISSING_LIST="$MISSING_LIST\n  MISSING    $slug"
    missing=$((missing + 1)); return
  fi
  if ! playable "$src"; then
    MISSING_LIST="$MISSING_LIST\n  UNREADABLE $slug"
    truncated=$((truncated + 1)); return
  fi
  mkdir -p "$DEST/$dir"
  cp -f "$src" "$DEST/$dir/$slug.mp4"
  copied=$((copied + 1))
}

# ── the short library, filed by the console it films ────────────────
mapfile -t ROWS < <(node -e '
  Promise.all([import("./scripts/tutorials/flows.mjs"), import("./scripts/tutorials/long/index.mjs")]).then(([f, l]) => {
    const long = new Set(Object.keys(l.LONG_FLOWS ?? {}));
    for (const [s, fl] of Object.entries(f.FLOWS)) {
      if (!long.has(s)) console.log(s + " " + (fl.app ?? "seller"));
    }
  });')
for row in "${ROWS[@]}"; do
  set -- $row
  place "$1" "${FOLDER[$2]:-Other}"
done

# ── the long ones, by language ──────────────────────────────────────
for s in "${LONG_EN[@]}"; do place "$s" "Long tutorials/English"; done
for s in "${LONG_BN[@]}"; do place "$s" "Long tutorials/বাংলা (Bangla)"; done
for s in "${LONG_HI[@]}"; do place "$s" "Long tutorials/हिन्दी (Hindi)"; done
for s in "${PROMOS[@]}"; do place "$s" "Promos"; done

echo
echo "Delivered to: $DEST"
find "$DEST" -mindepth 1 -maxdepth 2 -type d | sort | while read -r d; do
  n=$(find "$d" -maxdepth 1 -name '*.mp4' | wc -l)
  [ "$n" -gt 0 ] && printf "  %-34s %3d video(s)\n" "${d#$DEST/}" "$n"
done
echo
echo "copied $copied · missing $missing · unreadable $truncated"
[ -n "$MISSING_LIST" ] && printf "%b\n" "$MISSING_LIST"
exit 0
