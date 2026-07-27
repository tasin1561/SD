# Security headers for the static marketing site

## Who needs this, and who does not

`apps/admin`, `apps/seller` and `apps/track` set their own headers in Next
(`packages/config/security-headers.mjs`) plus a per-request nonce CSP in
middleware. Caddy reverse-proxies those three and passes upstream headers
through untouched, so **do not add a `header` block to their site blocks** —
in particular never a second `Content-Security-Policy`. A browser enforces
every CSP header it receives, and the intersection of a nonce policy and a
static one blocks Next's own scripts.

`apps/marketing` is different. It is `output: 'export'`, so there is no Node
process in front of it — Caddy serves the files from
`/var/www/skydrop-marketing` directly and `headers()` in `next.config.mjs`
would never run. Its headers can only come from Caddy. That is what this
file is for.

## The block

Goes inside the existing `skydrop.online, www.skydrop.online { … }` site
block in `/etc/caddy/Caddyfile`, alongside the `@immutable` / `@html`
cache-control matchers already there.

```caddyfile
	# Security headers. This site is static (output: 'export'), so Next
	# never gets a chance to set them — see docs/caddy-security-headers.md.
	header {
		Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
		Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
		Cross-Origin-Opener-Policy "same-origin"
		X-DNS-Prefetch-Control "off"
		-Server
	}
```

## Why `'unsafe-inline'` here when the other apps refuse it

Deliberate, and the trade is not the same one.

A Next static export emits inline bootstrap scripts. Without a server there
is no per-request nonce to give them, so the only strict alternative is
per-build script hashes — which change on every deploy and rot silently the
first time someone regenerates the site without regenerating the header.
A CSP that is quietly wrong is worse than one that is honestly permissive.

And the stake is different. The marketing site is public, unauthenticated,
holds no token and talks to no API: an XSS there is defacement. On
admin/seller an XSS reads the in-memory access token (FE-1 keeps it in JS
memory by design, with no HttpOnly wall around it), which is why those three
get the nonce and this one does not.

`connect-src 'self'` still means an injected script on the marketing site
cannot exfiltrate anywhere, and `frame-ancestors 'none'` still stops
clickjacking.

## Applying it

```bash
ssh skydrop
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%F)
sudo nano /etc/caddy/Caddyfile          # paste the block above
sudo caddy validate --config /etc/caddy/Caddyfile   # MUST pass first
sudo systemctl reload caddy             # reload, not restart — no dropped conns
curl -sI https://skydrop.online/ | grep -i -E 'content-security|strict-transport|x-frame'
```

`caddy validate` before reload is the whole safety story: Caddy refuses to
load a broken config and keeps serving the old one, but validating first
turns "the reload failed and I have to read journalctl" into a one-line
error at the terminal.
