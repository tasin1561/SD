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
		Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"
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

## Why Google Fonts is allowed here and nowhere else

`style-src` and `font-src` name `fonts.googleapis.com` and
`fonts.gstatic.com` because the marketing pages load their typefaces from
there. The first version of this file omitted them, which did not break the
pages — it silently dropped them to system fallbacks, which is worse than a
visible failure because nobody notices for weeks.

The three app CSPs deliberately do NOT allow this: those pages self-host
their fonts through `next/font`, so an external font origin there would be
permission nobody needs.

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

---

## A missing asset must 404, not become the homepage (2026-08-18)

The marketing block served the static export with a single catch-all:

```
try_files {path} {path}.html {path}/index.html /index.html
```

That last fallback answers **any** unknown path with the landing page and a
**200**. It is right for page routes — a static export has no server-side
router — and wrong for anything that looks like a file.

It cost us the favicons. Before they existed, `GET /favicon.ico` returned
the homepage HTML with a 200. The cache matcher below it is
`@html path *.html /`, which does not match `/favicon.ico`, so that
response carried no `Cache-Control`, and **Cloudflare applied its default
four-hour TTL and cached the homepage under `/favicon.ico`**. Publishing
the real icon did not help: the edge kept serving its cached HTML
(`cf-cache-status: HIT`, `age: 3114`) while the origin returned
`image/vnd.microsoft.icon` the whole time. The same trap catches any
mistyped asset path, and it is invisible — a 200 with a body looks fine
until you check the content type.

The fix splits the two cases. Requests with a file extension are served by
`file_server` alone, so a miss is a real 404; everything else keeps the
SPA fallback:

```
handle {
    root * /var/www/skydrop-marketing

    @asset path_regexp \.[A-Za-z0-9]+$
    handle @asset {
        file_server
    }

    handle {
        try_files {path} {path}.html {path}/index.html /index.html
        file_server
    }
}
```

Nested `handle` blocks are what make this work: Caddy sorts directives by
type rather than by the order they are written, so two sibling `handle`s
are mutually exclusive and the asset case genuinely wins for asset paths.
Same reasoning as the `/api/public/invite-leads` block above it.

**Verify all four, and check the CONTENT TYPE, not the status code:**

```bash
for u in /favicon.ico /og.png /brand/skydrop-icon.svg /nope.png / /request-invite; do
  printf '%-28s %s\n' "$u" \
    "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' \
       -H 'Host: skydrop.online' --resolve skydrop.online:443:127.0.0.1 \
       https://skydrop.online$u)"
done
# assets: 200 + their real type · /nope.png: 404 · pages: 200 text/html
```

**The edge cache is separate.** Fixing the origin does not evict what
Cloudflare already stored — that needs a dashboard purge of the affected
URLs, or waiting out the remaining TTL. There are still no Cloudflare
credentials on the droplet or in the repo, so this cannot be scripted.
