# Renaming the three consoles — what was done, and what is left

`app.` → `client.` · `reseller.` → `member.` · `portal.` → `associate.`

**Steps 1–3 are DONE as of 2026-10-13.** All six hostnames serve; nobody
was signed out. What remains is step 5, which is a decision about a date
rather than a task. CLAUDE.md records the invariant as CON-1.

---

## Why the old names SERVE rather than redirect

A `__Host-` cookie is bound to the exact origin that set it. Redirect
`app.skydrop.global` to `client.skydrop.global` and the browser arrives
carrying no session: **every signed-in seller is logged out**, and a
bookmark lands on a login screen rather than where it used to go.

So both names serve the same app. An existing session keeps working on
the old name, a new one starts on the new name, and nobody is signed out.
Two live origins per console is the price, and it is temporary — step 5.

---

## 1. Cloudflare DNS — DONE (owner, 2026-10-13)

Three proxied records added on `skydrop.global`: `client`, `member`,
`associate`, each twinning the record it replaces. `app`, `reseller` and
`portal` were left exactly as they were.

**Proxied matters.** `ufw` on the droplet only admits Cloudflare's
ranges, so a grey-cloud (DNS-only) record resolves to an address the
firewall refuses and the host simply times out.

## 2. Caddy — DONE (2026-10-13)

The new hostname was added to the **existing** block for each app rather
than given a block of its own — same app, same port, one certificate per
name, nothing duplicated:

```caddyfile
client.skydrop.global, app.skydrop.online, app.skydrop.global { … :3003 }
member.skydrop.global, reseller.skydrop.online, reseller.skydrop.global { … :3005 }
associate.skydrop.global, portal.skydrop.global { … :3007 }
```

Each block's `header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}`
and `encode gzip zstd` were left byte-identical, and **no `header` block
was added** — these apps set their own nonce CSP in Next, and a second
Content-Security-Policy is enforced by the browser as the INTERSECTION of
the two, which blocks Next's own scripts. The file's own header says so.

Backups on the droplet: `/etc/caddy/Caddyfile.bak-20261013-rename` and
`~/app/.env.bak-20261013-rename`.

### Certificates: wait for them before judging it

Caddy prefers TLS-ALPN-01, which **cannot** complete behind the
Cloudflare proxy. It falls back to HTTP-01 and succeeds. **Measured on
2026-10-13**, all three at once: challenges solved through eight
different Cloudflare edge addresses, three chains downloaded, **seven
seconds** from `systemctl reload caddy`.

Before the reload all three answered Cloudflare **525** (SSL handshake
failed to origin) — DNS resolving, Cloudflare reaching the droplet, Caddy
holding no block for the name. That is the signature of a missing site
block, and it is worth telling apart from a certificate problem: **a 525
that persists after issuance means the Caddyfile, not ACME.**

```bash
sudo journalctl -u caddy -f | grep -i 'obtain\|certificate'
# wait for: certificate obtained successfully
```

## 3. The API's generated links — DONE (2026-10-13)

In `~/app/.env` on the droplet:

```
SELLER_APP_URL=https://client.skydrop.global
RESELLER_APP_URL=https://member.skydrop.global
ASSOCIATE_APP_URL=https://associate.skydrop.global
```

`ASSOCIATE_APP_URL` was previously **unset**, leaning on the schema
default. Production states a hostname rather than leaning on one.

Picked up by the deploy's own `pm2 restart "$ECOSYSTEM" --update-env`,
which re-reads the file — so no separate restart was needed, and
production was restarted once rather than twice.

## 4. Verify

```bash
for h in client member associate app reseller portal; do
  printf '%-26s ' "$h.skydrop.global"
  curl -s --max-time 25 "https://$h.skydrop.global/login" \
    | grep -o '<title>[^<]*</title>' | head -1
done
```

Measured 2026-10-13 — all six `200`, each new name paired with its old
one on the same app:

| hostname | title |
|---|---|
| `client.skydrop.global` | Skydrop Seller |
| `app.skydrop.global` | Skydrop Seller |
| `member.skydrop.global` | Skydrop Reseller |
| `reseller.skydrop.global` | Skydrop Reseller |
| `associate.skydrop.global` | Skydrop Portal |
| `portal.skydrop.global` | Skydrop Portal |

The one thing curl cannot tell you: open a browser where you are already
signed in on an **old** hostname and reload it. You must still be signed
in. That is the whole point of serving rather than redirecting.

## 5. Finish it later — the only step still open

Three extra live origins is a transition cost, not a destination. Decide
a date — sixty to ninety days is generous for bookmarks and saved emails
— and watch whether the old names still see traffic:

```bash
sudo journalctl -u caddy --since '7 days ago' \
  | grep -oE '(app|reseller|portal)\.skydrop\.global' | sort | uniq -c
```

When a name is quiet, take it out of its block and give it a redirect of
its own:

```caddyfile
app.skydrop.global {
	redir https://client.skydrop.global{uri} permanent
}
```

and remove its entry from `LEGACY_CONSOLE_ORIGINS` in
`apps/api/src/config/env.service.ts`. By then any session on the old name
is long expired, so the logout that made a redirect unacceptable at
cutover costs nothing.

---

## What was deliberately NOT renamed

A dated record keeps the name that was true on its date. Rewriting one
makes it useless to whoever debugs from it later:

- `docs/infrastructure.md` — the RS-12 (2026-09-14) and ASSOC-1
  (2026-10-08) go-live sections, including their Caddy sketches.
- `scripts/deploy.sh` — the 2026-09-27 stale-build incident note.
- `apps/api/test/e2e/redaction-sql-matches-code.e2e-spec.ts` — the
  corpus labelled "Production shapes, 2026-09-30". A `client.` shape was
  added **beside** them, because both hostnames now appear in real
  outbound mail and the redaction has to hold for either.
