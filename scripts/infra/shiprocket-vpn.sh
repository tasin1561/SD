#!/usr/bin/env bash
# Shiprocket panel egress — NordVPN in a container, a loopback HTTP proxy out.
#
# ── WHY ──────────────────────────────────────────────────────────────
# Shiprocket's seller panel refuses the DigitalOcean address. Measured
# 2026-09-28: their own /v1/auth/login returns 200 with a valid JWT and
# every call afterwards is 401 with a bounce to /newlogin — identically
# from Dhaka and from the Bangalore droplet, and the owner's own Chrome
# reproduces it through the Bangalore IP while working fine through
# NordVPN. It is IP reputation, not geography and not automation
# detection: NordVPN retired its physical Indian servers in 2022, so its
# "India" is a virtual location physically elsewhere, and that works
# while a genuinely Indian datacenter address does not.
#
# ── WHAT THIS INSTALLS ───────────────────────────────────────────────
#   /home/skydrop/.config/nordvpn/token        the access token (NOT written here)
#   /home/skydrop/.config/nordvpn/gluetun.env  derived from it, 0600
#   /etc/systemd/system/shiprocket-vpn.service runs the container
#
# The container is gluetun, pinned by DIGEST. Only Shiprocket's browser
# uses it: it publishes an HTTP proxy on 127.0.0.1:1082 and its control
# server on 127.0.0.1:8001, and nothing else on this droplet is touched.
# The host's own routing is NOT changed — the API, Postgres, Redis,
# Caddy, Cloudflare and Spaces all keep the egress they have.
#
# ── FAIL CLOSED ──────────────────────────────────────────────────────
# gluetun runs its own firewall: while the tunnel is down or
# reconnecting it passes NO traffic at all, so a browser pointed at the
# proxy fails rather than quietly going out directly. The API asks the
# control server where it is coming from before every run
# (courier.shiprocket_portal_egress_check_url) and refuses when the
# answer is not the country we expect.
#
# ── ROLLBACK ─────────────────────────────────────────────────────────
#   sudo systemctl disable --now shiprocket-vpn
#   sudo rm /etc/systemd/system/shiprocket-vpn.service && sudo systemctl daemon-reload
#   then on /settings set  courier.shiprocket_portal_proxy = socks5://127.0.0.1:1081
#   and clear courier.shiprocket_portal_egress_check_url.
# The Bangalore tunnel (shiprocket-egress-tunnel.service) is left running
# and untouched, so that is a settings change and not a deploy.
#
# Usage:  sudo bash shiprocket-vpn.sh install | status | write-env | rotate-key | uninstall
set -Eeuo pipefail
umask 077

IMAGE='qmcgaw/gluetun@sha256:2b42bfa046757145a5155acece417b65b4443c8033fb88661a8e9dcf7fda5a00'
IMAGE_TAG='qmcgaw/gluetun:v3.40.0'
UNIT=/etc/systemd/system/shiprocket-vpn.service
# The unit calls this script on every start, so it needs a path a
# deploy cannot rewrite mid-run. `install` puts a copy here.
INSTALLED=/usr/local/sbin/shiprocket-vpn
CONF_DIR=/home/skydrop/.config/nordvpn
TOKEN_FILE="$CONF_DIR/token"
ENV_FILE="$CONF_DIR/gluetun.env"
NAME=shiprocket-vpn
PROXY_PORT=1082
CONTROL_PORT=8001
# NordVPN's own country id for India. Their Indian servers are VIRTUAL
# (they retired the physical ones in 2022) and that is fine — what
# Shiprocket refuses is the datacenter address, not the geography.
COUNTRY_ID=100
# Replies to a connection that arrived over the docker bridge must not be
# forced into the tunnel, or a published port answers nobody.
BRIDGE_SUBNET=172.17.0.0/16

die() { echo "shiprocket-vpn: $*" >&2; exit 1; }

# The WireGuard key AND the server are derived from the access token and
# NordVPN's live API — nothing here is typed by hand.
#
# ── WHY gluetun's `custom` PROVIDER AND NOT `nordvpn` ────────────────
# As `nordvpn`, gluetun picks servers from a list baked into the image,
# and its India entries (81.17.122.x) complete no handshake at all. Worse,
# its healthcheck restarts RE-PICK a server on every failure and ignore a
# pinned endpoint, so a run that started in India rotated through the
# whole world and settled on a US exit — measured 2026-09-28, NordVPN's
# own insights endpoint reporting `Atlanta, US` while the config said
# India. A US exit is refused by Shiprocket's panel edge (403 on
# app.shiprocket.in/), so silently drifting off India is the one failure
# that must be unrepresentable.
#
# As `custom` there is no list and no rotation: gluetun connects to the
# endpoint it was given, every time. Choosing that endpoint is OUR job,
# which the unit re-does on every start — so a restart picks today's
# least-loaded India server rather than yesterday's.
#
# Every NordVPN WireGuard server currently shares ONE peer public key, so
# only the address varies; 10.5.0.2/32 is the address NordLynx assigns
# every client.
write_env() {
  [ -r "$TOKEN_FILE" ] || die "no NordVPN access token at $TOKEN_FILE"
  local tmp
  tmp="$(mktemp "$CONF_DIR/.gluetun.env.XXXXXX")"
  BRIDGE_SUBNET="$BRIDGE_SUBNET" COUNTRY_ID="$COUNTRY_ID" TOKEN_FILE="$TOKEN_FILE" \
    python3 - >"$tmp" <<'PYEOF'
import base64, json, os, urllib.request

token = open(os.environ["TOKEN_FILE"]).read().strip()
if not token:
    raise SystemExit("the token file is empty")


def get(url: str, auth: bool = False):
    req = urllib.request.Request(url)
    if auth:
        # NordVPN takes the access token as an HTTP basic password under
        # the literal username "token".
        basic = base64.b64encode(f"token:{token}".encode()).decode()
        req.add_header("Authorization", "Basic " + basic)
    return json.load(urllib.request.urlopen(req, timeout=30))


key = get("https://api.nordvpn.com/v1/users/services/credentials", auth=True)[
    "nordlynx_private_key"
]

server = get(
    "https://api.nordvpn.com/v1/servers/recommendations"
    f"?filters[country_id]={os.environ['COUNTRY_ID']}"
    "&filters[servers_technologies][identifier]=wireguard_udp&limit=1"
)[0]
peer = next(
    {m["name"]: m["value"] for m in t.get("metadata", [])}["public_key"]
    for t in server["technologies"]
    if t["identifier"] == "wireguard_udp"
)

print("# Generated by shiprocket-vpn.sh — regenerated on every service start.")
print(f"# Server: {server['hostname']} {server['station']} (load {server['load']}%)")
print("VPN_SERVICE_PROVIDER=custom")
print("VPN_TYPE=wireguard")
print(f"WIREGUARD_PRIVATE_KEY={key}")
print(f"WIREGUARD_PUBLIC_KEY={peer}")
print(f"WIREGUARD_ENDPOINT_IP={server['station']}")
print("WIREGUARD_ENDPOINT_PORT=51820")
print("WIREGUARD_ADDRESSES=10.5.0.2/32")
print("HTTPPROXY=on")
print("HTTPPROXY_LISTENING_ADDRESS=:8888")
print("FIREWALL=on")
print(f"FIREWALL_OUTBOUND_SUBNETS={os.environ['BRIDGE_SUBNET']}")
print("DOT=off")
print("TZ=Asia/Kolkata")
PYEOF
  chmod 600 "$tmp"
  chown skydrop:skydrop "$tmp"
  mv "$tmp" "$ENV_FILE"
  # The server line is the only part worth reading back; the keys are not.
  grep '^# Server:' "$ENV_FILE" || true
}

write_unit() {
  cat >"$UNIT" <<EOF
[Unit]
Description=NordVPN egress for the Shiprocket panel only (loopback HTTP proxy on $PROXY_PORT)
Documentation=file:///home/skydrop/app/docs/infrastructure.md
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
# --rm plus ExecStartPre rm: a container left behind by a hard kill must
# not stop the next start, and a stale one must not answer for a live VPN.
# A start picks today's India server. Non-fatal (the leading '-'):
# NordVPN's API being unreachable must not leave the VPN down when the
# last good server is still fine.
ExecStartPre=-$INSTALLED write-env
ExecStartPre=-/usr/bin/docker rm -f $NAME
ExecStart=/usr/bin/docker run --rm --name $NAME \\
  --cap-add=NET_ADMIN --device /dev/net/tun:/dev/net/tun \\
  --env-file $ENV_FILE \\
  -p 127.0.0.1:$PROXY_PORT:8888/tcp \\
  -p 127.0.0.1:$CONTROL_PORT:8000/tcp \\
  $IMAGE
ExecStop=/usr/bin/docker stop -t 20 $NAME
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
  echo "wrote $UNIT"
}

wait_healthy() {
  local i answer
  for i in $(seq 1 60); do
    answer="$(curl -fsS --max-time 5 "http://127.0.0.1:$CONTROL_PORT/v1/publicip/ip" 2>/dev/null || true)"
    if [ -n "$answer" ] && ! echo "$answer" | grep -q '"public_ip":""'; then
      echo "$answer"
      return 0
    fi
    sleep 5
  done
  die "the VPN did not report a public IP within five minutes — journalctl -u shiprocket-vpn"
}

case "${1:-}" in
  install)
    [ "$(id -u)" -eq 0 ] || die "run as root"
    docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE_TAG"
    install -m 0755 "${BASH_SOURCE[0]}" "$INSTALLED"
    write_env
    write_unit
    systemctl daemon-reload
    systemctl enable "$NAME"
    # restart, not `enable --now`: --now is a no-op on a unit that is
    # already running, so a re-install silently kept the OLD config —
    # which read as "installed and healthy" while answering from the
    # previous server (measured 2026-09-28).
    systemctl restart "$NAME"
    wait_healthy
    ;;
  write-env)
    [ "$(id -u)" -eq 0 ] || die "run as root"
    write_env
    ;;
  rotate-key)
    [ "$(id -u)" -eq 0 ] || die "run as root"
    write_env
    systemctl restart "$NAME"
    wait_healthy
    ;;
  status)
    systemctl is-active "$NAME" || true
    curl -fsS --max-time 5 "http://127.0.0.1:$CONTROL_PORT/v1/publicip/ip" || echo "control server not answering"
    echo
    ;;
  uninstall)
    [ "$(id -u)" -eq 0 ] || die "run as root"
    systemctl disable --now "$NAME" || true
    rm -f "$UNIT" "$INSTALLED"
    systemctl daemon-reload
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "removed. Set courier.shiprocket_portal_proxy back to socks5://127.0.0.1:1081"
    echo "and clear courier.shiprocket_portal_egress_check_url on /settings."
    ;;
  *)
    die "usage: $0 install|status|write-env|rotate-key|uninstall"
    ;;
esac
