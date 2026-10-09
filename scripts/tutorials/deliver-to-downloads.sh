#!/usr/bin/env bash
#
# Copy each finished long video into the Windows Downloads folder as
# soon as it is written.
#
#   scripts/tutorials/deliver-to-downloads.sh            # watch until all six exist
#   scripts/tutorials/deliver-to-downloads.sh --once     # copy whatever is ready now
#
# WHY A WATCHER AND NOT A COPY AT THE END. Six videos take the better
# part of an hour across two stacks, and a finished one is watchable
# while the rest are still recording. Waiting for the set would hold the
# first video back for forty minutes for no reason.
#
# WAITING FOR THE FILE TO BE FINISHED, not merely to exist. ffmpeg
# creates the mp4 and then writes into it for a minute or more, so a
# copy taken on first sight is a truncated file that plays for four
# seconds and looks like a broken render. The check here is that the
# size has stopped changing AND `ffprobe` can read a duration out of it
# — the second part matters because a stalled write also stops growing.
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SRC="$ROOT/scripts/tutorials/out"
DEST="${SKYDROP_DELIVER_DIR:-/mnt/c/Users/User/Downloads}"

# The FULL set, in the order somebody would watch them. The three
# tutorials exist in three languages; the promos are English only —
# the owner asked for translations of the tutorials and not the promos,
# and a promo is the one film most likely to be re-cut anyway.
SLUGS=(
  seller-everything
  reseller-everything
  associate-everything
  seller-everything-bn
  reseller-everything-bn
  associate-everything-bn
  seller-everything-hi
  reseller-everything-hi
  associate-everything-hi
  promo-seller
  promo-reseller
  promo-associate
)

if [ ! -d "$DEST" ]; then
  echo "No destination at $DEST — set SKYDROP_DELIVER_DIR to somewhere that exists."
  exit 1
fi

# A NAME SOMEBODY CAN READ IN A DOWNLOADS FOLDER. `promo-associate.mp4`
# means nothing next to a hundred other files; the prefix groups the set
# and the words say what it is.
pretty() {
  case "$1" in
    seller-everything) echo "Skydrop - 1 - Seller - everything.mp4" ;;
    reseller-everything) echo "Skydrop - 2 - Reseller - everything.mp4" ;;
    associate-everything) echo "Skydrop - 3 - Associate - everything.mp4" ;;
    # The LANGUAGE leads on the translated ones, so the three Bangla
    # files sit together in a folder sorted by name rather than being
    # scattered between the English ones.
    seller-everything-bn) echo "Skydrop - Bangla - 1 - Seller.mp4" ;;
    reseller-everything-bn) echo "Skydrop - Bangla - 2 - Reseller.mp4" ;;
    associate-everything-bn) echo "Skydrop - Bangla - 3 - Associate.mp4" ;;
    seller-everything-hi) echo "Skydrop - Hindi - 1 - Seller.mp4" ;;
    reseller-everything-hi) echo "Skydrop - Hindi - 2 - Reseller.mp4" ;;
    associate-everything-hi) echo "Skydrop - Hindi - 3 - Associate.mp4" ;;
    promo-seller) echo "Skydrop - Promo - Seller.mp4" ;;
    promo-reseller) echo "Skydrop - Promo - Reseller.mp4" ;;
    promo-associate) echo "Skydrop - Promo - Associate.mp4" ;;
    *) echo "$1.mp4" ;;
  esac
}

settled() {
  local f="$1"
  [ -f "$f" ] || return 1
  local a b
  a=$(stat -c %s "$f" 2>/dev/null || echo 0)
  sleep 6
  b=$(stat -c %s "$f" 2>/dev/null || echo 0)
  [ "$a" = "$b" ] && [ "$a" != "0" ] || return 1
  # A readable duration is what tells a finished file from a stalled one.
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" >/dev/null 2>&1
}

declare -A done_already=()
once=0
[ "${1:-}" = "--once" ] && once=1

while true; do
  pending=0
  for slug in "${SLUGS[@]}"; do
    [ -n "${done_already[$slug]:-}" ] && continue
    src="$SRC/$slug.mp4"
    if settled "$src"; then
      name="$(pretty "$slug")"
      # Copy to a temporary name first and move it into place, so a
      # half-copied file is never sitting in Downloads under the name
      # somebody is about to double-click.
      cp "$src" "$DEST/.$name.part" 2>/dev/null && mv "$DEST/.$name.part" "$DEST/$name" 2>/dev/null
      if [ -f "$DEST/$name" ]; then
        dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src" 2>/dev/null | cut -d. -f1)
        mins=$((dur / 60)); secs=$((dur % 60))
        printf 'DELIVERED  %s  (%s, %dm%02ds)\n' \
          "$name" "$(du -h "$src" | cut -f1)" "$mins" "$secs"
        done_already[$slug]=1
      fi
    else
      pending=$((pending + 1))
    fi
  done
  [ "$pending" = "0" ] && { echo "EVERY VIDEO DELIVERED to $DEST"; break; }
  [ "$once" = "1" ] && { echo "$pending still to come"; break; }
  sleep 20
done
