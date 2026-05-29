# CP2 feature manual smoke

The Module 12 frontend e2e/integration choice (per the M12 FINAL plan):

> **Option (b) — integration + documented manual smoke**, deferring a
> Playwright harness to apps/seller when the surface doubles.

This document captures the canonical reproducible smoke for the CP2
feature areas. Pairs with:

- **CP1_VERIFICATION.md** — the auth loop (login → SSR /me → refresh-
  through-proxy → logout). 7 steps; verified.
- **`apps/admin/src/tests/*-fe2.test.tsx`** — the 7 FE-2 boundary
  component tests (server-verdict-verbatim, escalating-gravity
  chrome, typed-confirm gate, cosmetic RBAC).
- **`packages/api-client/src/tests/*`** — 16 vitest tests covering
  single-flight refresh + token store.
- **`packages/auth/src/tests/*`** — 10 vitest tests covering the
  SSR cookie→/me non-rotation invariant + the AuthProvider hooks.

Together these are the integration coverage for M12. A full
Playwright harness becomes the right investment when apps/seller
lands (Q3 frontend cycle) and the cost is amortized across two
apps. For M12 alone the harness cost > the marginal value
beyond what the boundary tests + auth verification already pin.

---

## Why this approach over Playwright for M12

| | Playwright now | Integration + smoke (chosen) |
|---|---|---|
| Boundary coverage | Yes (with selector-flakes) | Yes — 7 FE-2 tests + 26 package tests |
| Auth-loop coverage | Yes (would re-prove CP1) | Yes — CP1_VERIFICATION.md (7 steps live) |
| CI cost | +150MB browsers + headless run | $0 — existing vitest job covers it |
| Harness time | 2–4 hours setup + maintenance | 30 min smoke doc; refreshes with code |
| Value when apps/seller lands | Amortized over 2 apps | Re-evaluate then; same surface ×2 makes it worth it |

The user-approved steer:
> "if Playwright setup balloons, (b) is acceptable for M12 and full
> e2e becomes a fast-follow when apps/seller doubles the surface
> worth covering"

CP1_VERIFICATION.md already proves the foundation loop end-to-end
against the real stack. CP2's feature areas all consume the same
foundation; once it holds + the boundary tests pin the
state-changing surfaces, a full Playwright smoke is mostly proving
selectors haven't moved.

---

## How to run the manual smoke

### Prereqs

```bash
# Datastores
docker compose -f docker/docker-compose.yml up -d

# API (port 4000)
pnpm --filter @skydrop/api start:dev > /tmp/api.log 2>&1 &
until curl -s -o /dev/null http://localhost:4000/health; do sleep 1; done

# Admin (port 3002) — API_ORIGIN points at the API
pnpm --filter @skydrop/admin build
API_ORIGIN=http://localhost:4000 pnpm --filter @skydrop/admin start > /tmp/admin.log 2>&1 &
until curl -s -o /dev/null http://localhost:3002/login; do sleep 1; done

# Seed a SUPER_ADMIN staff user (one-off; see CP1_VERIFICATION.md
# for the exact script). cp1@skydrop.test / CP1Verify-Password!42.
```

### Smoke 1 — seller management (CP2.7)

Open `http://localhost:3002/login`, sign in as the seeded SUPER_ADMIN.

1. Click **Sellers** in the sidebar. The sellers list loads.
2. Click **Invite seller** (top right). Enter `smoke-1@example.com`
   and submit. The modal closes; the pending-invitations panel
   should now show one row.
3. Open the invitations panel (collapsible header). The invitation
   you just created appears with status `pending`. Click **Resend**
   — it stays `pending` but the token rotates (the email goes out
   again).
4. Click the trash icon → confirm. The invitation is removed.
5. If any seller rows exist in the list, click one to open the
   detail page. The header shows the company + email + status
   badge.
6. **Suspend / Reapprove action (the CP2.7 well-built template)**:
   - If APPROVED: click **Suspend account** → modal opens.
   - Type a short reason (optional). Click **Suspend**.
   - On success: modal closes, status badge updates to `SUSPENDED`,
     audit row is written server-side.
   - Click **Reapprove account** → modal → confirm. Back to APPROVED.
7. **FE-2 verification (cosmetic vs server)**: sign out, sign in as
   a non-`SELLER_APPROVAL_ADMIN` / non-`SUPER_ADMIN` staff (e.g.,
   `CALL_AGENT`). The Suspend / Reapprove buttons are visible but
   DISABLED with the role-restriction note. (Equivalent server gate
   not landed in Phase-1A — phase-1a-debt; the UI gate is the
   advance work.)

### Smoke 2 — order list + filters (CP2.8)

Sign back in as SUPER_ADMIN. Click **Orders**.

1. The orders list loads (empty if no orders have been created;
   create one via the seller portal or seed if needed).
2. Type in the search box → press Enter. URL updates to
   `?search=…`; list filters. Browser back/forward navigates.
3. Pick a status from the dropdown. URL → `?status=…`. Sources
   dropdown works the same way.
4. Click **Clear filters** → URL → `/orders`.
5. Verify the status badge colors render via @skydrop/ui tokens
   (Inspect → the badge `style` references `var(--status-*-fg)` /
   `var(--status-*-bg)`).

### Smoke 3 — order detail + sane admin cancel (CP2.9)

Click an order from the list.

1. Detail page renders: header (number + Seller ref + status
   badge), Recipient block, Payment + Physical cards, Items table,
   Notes (if present).
2. Scroll to **Lifecycle actions** at the bottom. If the order is
   in a non-terminal state, **Cancel order** is enabled.
3. Click → modal → choose a cancellation reason from the dropdown
   + optional note → **Confirm cancel**.
4. On success: page refetches; status badge updates to
   `CANCELLED_BY_ADMIN`.
5. **FE-2 verification (matrix-server-guarded)**: try to cancel
   from a terminal state via god-mode (Smoke 4) first, then
   attempt sane cancel → button should be disabled with a tooltip
   ("Already in a terminal state").

### Smoke 4 — god-mode override (CP2.10)

On an order's detail page, scroll to **God-mode (ORD-2)**.

1. Verify the panel chrome conveys gravity: red border, ShieldAlert
   icon, "Audited CRITICAL" copy, mention of the permanent
   `hasAdminOverride` flag.
2. Click **Force-mutate…**. Dialog opens with red title + critical
   notice banner.
3. Toggle a field (e.g., "Internal notes" under Notes + cancellation
   → tick the checkbox → edit the value).
4. Toggle **Force order status** → pick a target from the dropdown.
5. Type in the justification. Watch the counter: it stays gray
   until 30 chars, then turns green (`text-delivered`).
6. Tick **I acknowledge the data-integrity risk**.
7. **Continue → confirmation** activates.
8. Step 2 (typed-confirm): the summary block lists exactly what you
   staged. Type random text in the FORCE-MUTATE input — submit
   stays disabled. Type `force-mutate` (wrong case) — still
   disabled. Type `FORCE-MUTATE` exactly — now enabled.
9. **Back** → returns to Step 1 with the staged state intact (test
   this — proves the UX doesn't lose work).
10. Submit → server applies. The dialog closes. An
    **OverrideResultPanel** appears on the page:
    - `fromStatus → status` line
    - `Fields applied: <list>`
    - `hasAdminOverride: true (permanent)`
    - If the move was → CONFIRMED on an order with items: a
      `Reserve attempts` block with ✓/✗ per line + the reservation
      id or error from the SERVER (FE-2 — what the UI displays is
      what the server reported).
11. The order detail header now shows the **Override** badge
    permanently. Refresh the page — badge stays.
12. **FE-2 verification (server is the gate)**: open the dialog
    again. Type a reason of exactly 30 chars that contains leading
    whitespace (e.g., `   ` + 27 chars). The UI's counter shows
    30 (no trim there) but the server's `reason.trim().length`
    check rejects → `[FORCE_MUTATION_REASON_TOO_SHORT]` shows in
    the dialog verbatim. (This is the exact scenario the FE-2
    boundary test in `god-mode-fe2.test.tsx` pins.)
13. **Release reservations** (god-mode cleanup): if the override
    moved away from CONFIRMED, click it → confirm → the
    `ReleaseResultPanel` appears with the per-reservation outcome
    list (`releasedCount` + each row's `qtyReleased` /
    `alreadyInactive`).

### Smoke 5 — logout

Click **Sign out** in the top-right. Hard nav to `/login`. Refresh
`/dashboard` → SSR redirects to `/login` (cookie cleared). All
five smokes complete.

---

## What this smoke doesn't cover (intentional)

- **Cross-browser**: covered by the Tailwind v4 + Next.js 15 + React 19
  combination's own browser-compat matrix. Phase-1A targets evergreen
  Chrome/Firefox/Safari; a future Playwright run would pin Edge +
  mobile webview if needed.
- **Concurrent operators**: server-side races (e.g., two admins
  editing the same order via god-mode) are guarded by the order's
  `updatedAt` versioning + audit chronology, not by UI locks.
- **Visual regressions**: covered by the design-token system —
  status colors are F2-exhaustive over the enum vocabulary so a
  changed palette ripples uniformly. A future Percy/Chromatic
  pass would catch fine pixel drift.
- **Performance budgets**: deferred to Phase-2 observability.

---

## When to upgrade to Playwright

When apps/seller lands (M13 or later):

- The same auth proxy + shared packages serve TWO apps. The
  Playwright cost amortizes across both.
- The seller flow has different role checks + APPROVED-status
  gates — a single Playwright fixture per identity-kind covers
  both apps.
- A breaking change to the proxy (or to the shared packages)
  would silently flake one of the two apps without browser-level
  verification.

At that point: install `playwright` + `playwright/test`,
configure a global setup that spins up the stack (mirroring this
doc's prereqs), seed staff + seller fixtures, and write four
or five fixture-driven specs replacing this manual smoke. The
manual smoke stays as documentation; the Playwright suite becomes
the per-PR gate.
