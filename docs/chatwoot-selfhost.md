# ChatWoot self-host (chat.skydrop.online)

ChatWoot is the live-chat surface customers + sellers see (and where ops responds). We self-host so customer conversation data stays on our infrastructure.

## Architecture

| Component | Where |
|---|---|
| ChatWoot Rails app + Sidekiq worker | A SEPARATE small DigitalOcean droplet (`chat.skydrop.online`) — not the existing skydrop-app-prod box. |
| Postgres for ChatWoot | Same droplet, in the docker-compose. |
| Redis for ChatWoot | Same droplet, in the docker-compose. |
| Nginx (TLS termination + proxy) | On the chat droplet, mirrors the pattern of skydrop-app-prod |

Keeping ChatWoot off the main app droplet is intentional:
- ChatWoot ships its own Redis schemas / Sidekiq queue; isolating it avoids competing with our M11 BullMQ worker pool.
- Different release cadence — ChatWoot upgrades shouldn't drag the API.
- A bad chatwoot deploy can be restarted without touching skydrop-api.

## Droplet sizing

- **Basic ($12/mo, 2GB RAM, 1 vCPU, 50 GB SSD)** — Phase 1A volume (a few hundred conversations / month).
- Upgrade to General Purpose ($24/mo) if you cross 1k concurrent users.

## Provisioning steps

```bash
# 1. Create the droplet
#    DigitalOcean → Create → Droplets → Ubuntu 24.04 → Basic 2GB → SGP1
#    Add your SSH key.

# 2. Point a DNS record
#    Cloudflare → skydrop.online → DNS → Add A record
#       Type: A
#       Name: chat
#       Content: <droplet-ipv4>
#       Proxy: ☁ Proxied (orange)  # ChatWoot is fine behind CF

# 3. SSH in and prep
ssh root@<chat-droplet-ip>
apt update && apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx ufw
useradd -m -s /bin/bash chat
usermod -aG docker chat
ufw allow OpenSSH; ufw allow http; ufw allow https; ufw --force enable

# 4. Drop the docker-compose stack
mkdir -p /home/chat/chatwoot && chown -R chat:chat /home/chat
sudo -u chat -i
cd ~/chatwoot
# scp the docs/chatwoot-selfhost-docker-compose.yml from the skydrop repo here:
#   scp talha@skydrop-app-prod:~/app/docs/chatwoot-selfhost-docker-compose.yml docker-compose.yml
# OR clone the repo / wget from a private gist.

# 5. Set secrets
cat > .env <<'EOF'
# Required — generate strong randoms.
SECRET_KEY_BASE=$(openssl rand -hex 64)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
# Match the public hostname (under Cloudflare proxy).
FRONTEND_URL=https://chat.skydrop.online
DEFAULT_LOCALE=en
RAILS_ENV=production
NODE_ENV=production
INSTALLATION_NAME=Skydrop
ENABLE_ACCOUNT_SIGNUP=false
# SMTP — point at the same Resend account we use for transactional
SMTP_ADDRESS=smtp.resend.com
SMTP_PORT=587
SMTP_USERNAME=resend
SMTP_PASSWORD=<your-resend-api-key>
MAILER_SENDER_EMAIL=Skydrop Support <support@skydrop.online>
EOF
chmod 600 .env

# 6. Start
docker compose up -d
docker compose exec rails bundle exec rails db:chatwoot_prepare

# 7. Nginx + TLS
# /etc/nginx/sites-enabled/chat-skydrop.conf — see chat-nginx.conf below
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d chat.skydrop.online --redirect --non-interactive --agree-tos -m support@skydrop.online

# 8. Open https://chat.skydrop.online
# → create the admin user (one-off; ENABLE_ACCOUNT_SIGNUP=false locks the rest)
# → Inboxes → Create new → API channel → name it "Skydrop API"
#    → grab the inbox id from the URL (last segment of /settings/inboxes/<id>)
# → Profile → Access tokens → Create new → copy the api_access_token
# → (optional) Webhooks tab on the inbox: set URL
#       https://api.skydrop.online/public/chat/webhooks/chatwoot
#   and the HMAC secret (anything strong; we'll mirror it in env).
```

## Wire the main app to ChatWoot

After step 8 you have three values to plug in:

```bash
# On skydrop-app-prod (the API droplet)
ssh skydrop
cd ~/app
# Edit apps/api/.env
sed -i "s|^CHATWOOT_API_TOKEN=.*|CHATWOOT_API_TOKEN=<paste api_access_token>|" apps/api/.env
sed -i "s|^CHATWOOT_HMAC_SECRET=.*|CHATWOOT_HMAC_SECRET=<paste HMAC secret>|" apps/api/.env

# Configure runtime via the system-settings UI (admin.skydrop.online/settings):
#   chat.chatwoot_base_url    = https://chat.skydrop.online
#   chat.chatwoot_account_id  = <numeric id>
#   chat.chatwoot_inbox_id    = <numeric id>

pm2 restart skydrop-api --update-env
```

## Verify

```bash
# Should now NOT return mode:"STUB" — should hit the real upstream
curl -s https://api.skydrop.online/public/chat/webhooks/chatwoot \
  -H "X-Chatwoot-Hmac-Token: <invalid>" -d '{}' | head -3
# → {"code":"CHATWOOT_SIGNATURE_MISMATCH",...}  ← real verification ON

# Drive a notifyOrderUpdate by transitioning any order (the listener
# fires automatically per NOTIF-1). Then check:
#   chat.skydrop.online → Conversations → expect an entry against the
#   customer phone.
```

## Rolling back to stub mode

Unset `CHATWOOT_API_TOKEN` (or `chat.chatwoot_base_url`) and restart skydrop-api. The client + webhook revert to stub behaviour automatically — no code change.
