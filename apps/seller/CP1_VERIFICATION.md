# CP1 manual verification — apps/seller refresh-through-proxy

The Module 13 CP1 gate for the seller portal — mirrors apps/admin's
CP1_VERIFICATION exactly with the seller IdentityKind. The same
load-bearing concern applies: a Set-Cookie passthrough or refresh
rotation issue won't surface until the access token expires 5 minutes
into a session.

## Setup

```bash
# Datastores up
docker compose -f docker/docker-compose.yml up -d

# API
pnpm --filter @skydrop/api start:dev > /tmp/api.log 2>&1 &
# Wait for the API on :4000
until curl -s -o /dev/null http://localhost:4000/health; do sleep 1; done

# Seller dev server
pnpm --filter @skydrop/seller dev > /tmp/seller.log 2>&1 &
# Wait for the seller dev on :3003
until curl -s -o /dev/null http://localhost:3003/login; do sleep 1; done

# Seed an APPROVED seller account (one-off — adapt the M12 CP1
# /tmp/seed-staff.ts script: create a Seller row with status=APPROVED,
# passwordHash from argon2, emailVerifiedAt set).
```

## What is exercised

All seven steps go through `http://localhost:3003/api/*` — i.e. the
Next.js route-handler proxy at
`apps/seller/src/app/api/[...path]/route.ts`. The proxy forwards each
request server-to-server to `http://localhost:4000/*` and streams the
response (including `Set-Cookie` headers) back.

| # | Request | Result |
|---|---|---|
| 1 | `POST /api/auth/seller/login` | 200 + `Set-Cookie: __Host-sellerRefresh=…; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604799` |
| 2 | `GET /api/auth/seller/me` (cookie only) | 200, identity returned, NO Set-Cookie on response (cookie path is read-only — M12 commit 1 invariant; CP1.2 verified) |
| 3 | `POST /api/auth/seller/refresh` (cookie only) | 200 + brand-new `Set-Cookie: __Host-sellerRefresh=…` |
| 4 | Compare cookie before vs after refresh | Rotated to a fresh plaintext |
| 5 | `GET /api/auth/seller/me` (NEW cookie) | 200 |
| 6 | `POST /api/auth/seller/logout` | 204 (cookie cleared on response) |
| 7 | `GET /api/auth/seller/me` (revoked cookie) | 401 |

The seven steps prove the same four properties as the admin
verification:

1. **Set-Cookie passthrough** — `__Host-` cookies have strict
   attribute requirements; the proxy must preserve them byte-for-byte.
2. **Refresh round-trip** — silent refresh fires ~5 min into a session;
   if the proxy mangles either direction the whole session breaks
   silently.
3. **Cookie path on /me is read-only** — SSR cookie→/me must NOT
   rotate (FE-4). A server-side rotate would race the client's
   silent-refresh and burn the legitimate session via the API's
   reuse-detection family-burn.
4. **Reuse-detection respected** — logout terminates the family;
   the revoked cookie returns 401, not a stale 200.

## Playwright smoke (CP1.7)

The boundary-style spec layer that doesn't need a seeded test user:

```bash
# Prereqs (same as above): docker, api, both Next.js dev servers
# will be auto-spawned by Playwright's webServer config.
pnpm e2e:fe
```

The 6 specs (3 admin, 3 seller) cover:
- Login page chrome rendering.
- Unauthed `/dashboard` → `/login` redirect (FE-4 from a real browser).
- Bad credentials surface the server's verdict verbatim (FE-2).

A spec that exercises the full POSITIVE login → /me → tracking deep
link round-trip needs a seeded seller user; that lives in CP2.A
fixtures once the test-user seeding helper is built.

## FE-5 in practice — what M13 CP1 actually proved

This is the second consumer of the `@skydrop/auth`, `@skydrop/api-client`,
`@skydrop/ui` packages — the M12 design assumed identity-parameterization
would hold; M13 CP1 PROVED it by booting the seller portal with the
exact same package surfaces, only the `IdentityKind` parameter changing.

What changed: `StaffMe → SellerMe`, `resolveStaffSsrIdentity →
resolveSellerSsrIdentity`, `__Host-staffRefresh → __Host-sellerRefresh`,
`identityKind: 'staff' → 'seller'`. Nothing else. The auth gate, proxy,
single-flight refresh, in-memory token store, AuthProvider, useApiClient,
the FE-2 server-verdict-verbatim discipline — all reused unchanged.

That outcome is what made CP1 quick relative to its CP1.1-1.7 scope.
The shared packages were genuinely shaped for two consumers; they just
needed a second one to validate it.
