# CP2 Feature Smoke — apps/seller pattern-setters

The Module 13 CP2 acceptance procedure. Same shape as
`apps/admin/CP2_FEATURE_SMOKE.md`: a documented manual walk that
covers the two pattern-setter feature areas (Orders + Catalog)
end-to-end. The integration tests + the Playwright login specs
(`pnpm e2e:fe`) sit underneath this; the manual smoke is the
fast-feedback proof that the pattern-setters compose.

The manual smoke is intentionally chosen over a Playwright-only
gate (per the M13 round-3 lean #5): Playwright covers boundary
disciplines (login, redirect, server-verdict-verbatim on bad
creds) cheaply; the feature workflows are richer than what's worth
encoding in fixtures-heavy specs until the M14+ surface expands.

## Setup

```bash
# Datastores up
docker compose -f docker/docker-compose.yml up -d

# API
pnpm --filter @skydrop/api start:dev > /tmp/api.log 2>&1 &
until curl -s -o /dev/null http://localhost:4000/health; do sleep 1; done

# Seller dev server
pnpm --filter @skydrop/seller dev > /tmp/seller.log 2>&1 &
until curl -s -o /dev/null http://localhost:3003/login; do sleep 1; done

# Seed an APPROVED seller account + a few products / orders (one-off
# scripts as needed; the M12 CP1 /tmp/seed-staff.ts shape adapts to
# seller: argon2 passwordHash, emailVerifiedAt, status=APPROVED.)
```

## CP2.A — Orders pattern-setter (read-heavy)

| # | Action | Expected |
|---|---|---|
| 1 | `GET /login`, sign in as approved seller | redirect to /dashboard; Recent Orders card shows latest 5 |
| 2 | Click "View orders" | /orders renders with data-table |
| 3 | Filter by status (Select) | URL gains `?status=...`; table refetches |
| 4 | Search (form submit) | URL gains `?search=...`; deep-link is shareable |
| 5 | Paginate | URL gains `?page=2`; back-button returns to page 1 |
| 6 | Click an order row | /orders/:id; recipient + payment + physical + items + Timeline rendered |
| 7 | Timeline section | Server-filtered events (`isVisibleToSeller=true`); FE-6 status transition badges |
| 8 | Force an NDR scan (admin webhook tool) for a DELIVERY_FAILED transition | A new notification_logs row appears with `ndr_reason` populated (humanized enum from latest delivery_attempt — M13 CP2.A.1 fix) |

## CP2.B — Catalog pattern-setter (write-heavy)

| # | Action | Expected |
|---|---|---|
| 1 | Click "Manage catalog" from dashboard | /catalog renders products list with StatusBadge |
| 2 | Filter by status / search | URL-driven; shareable |
| 3 | Click a product row | /catalog/products/:id; product info + variants table |
| 4 | Click "Edit product" | inline edit form replaces read card; SKU is NOT here (product-level) |
| 5 | Submit with valid data | form closes; refetch shows updated data |
| 6 | Submit with invalid data (server-rejected) | `[CODE] message` from ApiError body renders VERBATIM (FE-2); form stays OPEN |
| 7 | Click a variant SKU | /catalog/products/:productId/variants/:variantId; variant info + image card |
| 8 | Click "Edit variant" | inline form; SKU is DISABLED with "Immutable" hint |
| 9 | Drop 2-3 images on the dropzone | each row shows status (queued → uploading → registering → done); persisted grid below updates |
| 10 | Drop an unsupported file (e.g., .pdf) | row immediately shows `error` with `[INVALID_TYPE]` verdict (client-side type gate is UX; the server still validates) |
| 11 | Delete a persisted image (trash icon) | grid item disappears |

## FE-2 boundary verification

Every write action surfaces the server's `[code] message` VERBATIM:

- Product edit: server's PATCH 400 → `[code] message` appears in the
  form (not "Invalid input" or other client copy).
- Variant edit: same.
- Image upload: server's presign / register 400 → row carries
  `[code] message` verbatim.

The discipline is encoded in the form's `try/catch` (instanceof
ApiError → setServerError with `[err.code] err.message`) and the
image-upload's reads `err.body.code` / `err.body.message`. Drift in
either direction surfaces as a failing seller-side test (timeline
smoke is in place; explicit write-side FE-2 tests are a focused
follow-up — the discipline is structurally enforced and the admin
side already proves the pattern with 7 tests).

## What CP2 deferred (intentional)

- **Manual order create UI** — the M6 backend supports it
  (`POST /seller/orders`); the UI is fast-follow.
- **CSV order/product import UI** — backends exist (M4 + M6); the
  multi-state upload UI is fast-follow.
- **Inventory view** — the M5 backend supports per-seller stock
  reads; a /inventory tab is fast-follow.
- **Profile / Settings full UIs** — placeholder pages render
  through the shell; the read identity is in the topbar.
- **Order cancel from seller side** — exists in api-hooks
  (`useCancelOrder`); UI gating is fast-follow (matrix-aware
  pre-confirmation cancels only).
- **Tracking deep-link on order detail** — the AWB lives on the
  shipment, not the OrderView; a fast-follow either expands the
  view or surfaces a separate Track action when DISPATCHED+.

## Cost trade-off (vs Playwright e2e)

Same calculus as M12 CP2: Playwright doubles fixture cost (test
sellers + seed orders + product/variant fixtures) for a single
seller flow. The manual smoke is fast, exhaustive on the
pattern-setter shape, and the admin-side FE-2 tests + the seller
timeline smoke + the boundary disciplines (Playwright login
specs) anchor the parts that REGRESS silently.

Promote to a Playwright gate when the surface area or the
regression cost justifies the fixtures.
