# Marketing → API: the one proxied path

The landing page's invite form POSTs to `/api/public/invite-leads` on
its **own origin**. It has to: `apps/marketing` is a static export with
no Node process, so it has no route handler to proxy through, and its
CSP is `connect-src 'self'`, which blocks a cross-origin call to
`api.skydrop.online` outright.

So Caddy forwards exactly that one path — not `/api/*`, which would put
the entire authenticated API surface on the marketing hostname.

Add inside the existing `skydrop.online, www.skydrop.online { … }`
block, **before** the `root`/`file_server` directives:

```caddy
	# The invite form's only call. Scoped to this exact path on
	# purpose: `handle /api/*` would expose every admin and seller
	# endpoint on the marketing hostname, where none of them belong.
	handle /api/public/invite-leads {
		uri strip_prefix /api
		reverse_proxy 127.0.0.1:4000
	}
```

Then:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Why not CORS instead

Allowing `https://skydrop.online` as an origin on the API would work,
but it means the marketing site's CSP has to name the API host in
`connect-src`, and the API grows a cross-origin allowance that exists
for one form. Same-origin through Caddy keeps FE-3 intact — the browser
still talks only to the origin it loaded — and leaves the API's CORS
policy refusing everything, which is what makes it easy to reason about.
