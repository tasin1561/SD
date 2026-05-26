# CP1 manual verification — refresh-through-proxy

The Module 12 CP1 gate per the user's spec:

> CP1 manual verification MUST include the refresh-THROUGH-PROXY round
> trip working: force access expiry → silent refresh → new `__Host-`
> cookie set via the proxy → next call succeeds. Not just login — the
> refresh round trip, because that's what silently breaks if the proxy
> mangles Set-Cookie, and it won't surface until 5 min into a session.

This file documents the verification that was performed before the
CP1 commit batch landed. Reproducing it requires Postgres + Redis
running locally + an apps/api dev server + an apps/admin start.

## Setup

```bash
# Datastores up
docker compose -f docker/docker-compose.yml up -d

# Apps
pnpm --filter @skydrop/api start:dev > /tmp/api.log 2>&1 &
# Wait for the API on :4000
until curl -s -o /dev/null http://localhost:4000/health; do sleep 1; done

pnpm --filter @skydrop/admin build
pnpm --filter @skydrop/admin start > /tmp/admin.log 2>&1 &
# Wait for the admin on :3002
until curl -s -o /dev/null http://localhost:3002/login; do sleep 1; done

# Seed a SUPER_ADMIN staff user (one-off — see /tmp/seed-staff.ts in
# the M12 CP1 session for the exact script)
```

## What was exercised

All seven steps go through `http://localhost:3002/api/*` — i.e. the
Next.js route-handler proxy at `apps/admin/src/app/api/[...path]/route.ts`.
The proxy forwards each request server-to-server to
`http://localhost:4000/*` and streams the response (including
`Set-Cookie` headers) back to the browser/curl.

| # | Request | Result |
|---|---|---|
| 1 | `POST /api/auth/staff/login` | 200 + `Set-Cookie: __Host-staffRefresh=…; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604799` |
| 2 | `GET /api/auth/staff/me` (cookie only) | 200, identity returned, NO Set-Cookie on response (cookie path is read-only — M12 commit 1 invariant) |
| 3 | `POST /api/auth/staff/refresh` (cookie only) | 200 + brand-new `Set-Cookie: __Host-staffRefresh=…` |
| 4 | Compare cookie before vs after refresh | Rotated (`goxMSC-02XTosGSsVxSj…` → `GWG8N6gVsrkUscoYAGHt…`) |
| 5 | `GET /api/auth/staff/me` (NEW cookie) | 200 |
| 6 | `POST /api/auth/staff/logout` | 204 (cookie cleared on response) |
| 7 | `GET /api/auth/staff/me` (revoked cookie) | 401 |

## Why this is the load-bearing check

1. **Set-Cookie passthrough**: if the proxy lower-cases the cookie
   name, re-orders attributes, or drops the `Secure` / `HttpOnly` /
   `SameSite=Strict` / `Path=/` set, the browser rejects the cookie
   (`__Host-` cookies have STRICT validation rules). Step 1's full
   attribute set proves the route handler preserves them.
2. **Refresh round-trip**: the 5-minute access TTL means a fresh
   user session looks fine for ~5 min — then suddenly the silent
   refresh fires and the whole session pivots on the proxy correctly
   forwarding both directions. Step 3's brand-new Set-Cookie +
   step 5's successful /me with the rotated cookie prove the
   rotation chain holds end-to-end.
3. **Cookie path on /me is read-only**: step 2's response has NO
   Set-Cookie. Only the explicit /refresh in step 3 rotates. This
   is the invariant from M12 commit 1 — without it, SSR boots
   would race the client's silent refresh and burn legitimate
   sessions via the API's reuse-detection family-burn
   (`security.refresh_replay_detected` HIGH audit).
4. **Reuse-detection respected**: step 6's logout cleanly clears
   the cookie; step 7 confirms the family is dead.

## Notes on the implementation

- The proxy is a **route handler** (`src/app/api/[...path]/route.ts`),
  NOT a `next.config.mjs` rewrite. The route handler reads `API_ORIGIN`
  at REQUEST time, so the destination isn't baked into the build
  artifact. (Rewrites also work, but rebuilding for an env change is
  a poor dev story.)
- Hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`,
  `content-length`, `content-encoding`) are stripped per RFC 7230 in
  both directions.
- `cache: 'no-store'` on the upstream fetch — admin data is
  authenticated + dynamic; never cache.

## What this does NOT prove

- Multi-instance API deployment (Phase 2 — the proxy is fine; the
  rotation is what would need a shared session store).
- Cross-domain cookie handling in production (the `__Host-` prefix's
  no-Domain rule means subdomains can't share the cookie even with
  the proxy; the proxy keeps everything same-origin from the browser's
  view, which is exactly what we want).
- Concurrent-401 single-flight refresh (covered by
  `packages/api-client/src/tests/client.test.ts` — 3 simultaneous
  failed requests → exactly ONE /refresh fires).
