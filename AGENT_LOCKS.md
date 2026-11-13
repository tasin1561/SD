# Agent locks

Two agents push to `main`: **cloud Claude** and **Claude Code** (local). Before every edit and
after every `git pull`, read this file from `origin/main`. Never create, edit, move or delete
anything under a path the OTHER agent has claimed. Claim your own paths here, in a small commit
pushed to `main`, before starting new work; remove the claim when that work is merged.
Full protocol: CLAUDE.md → "Two agents on this repo".

One line per claim: `path or glob — date — what for`.

## Claimed by cloud Claude

Admin "easy pages" redesign (owner's list of 31 admin pages, 2026-11-13): light look, phone-first,
"i" info buttons with listen, plain words. Screen-only; no API, permission or status-logic changes.

- `apps/admin/src/components/easy/**` — 2026-11-13 — NEW shared pieces for these pages (info button, listen, light page header)
- `apps/admin/src/i18n/messages/easy.ts` — 2026-11-13 — NEW message file for those pieces
- `apps/admin/src/app/dev/easy/**` — 2026-11-13 — NEW dev-only test pages
- `apps/admin/src/app/(authed)/system-issues/**` — 2026-11-13 — batch 1 (pilot)
- `apps/admin/src/app/(authed)/call-center/**`, `apps/admin/src/app/(authed)/reattempt-requests/**` — 2026-11-13 — batch 2 (call centre)
- `apps/admin/src/app/(authed)/warehouse/{pack,handover,printing,receive,rto}/**` — 2026-11-13 — batch 3 (benches)
- `apps/admin/src/app/(authed)/warehouse/page.tsx`, `apps/admin/src/app/(authed)/warehouse/{bins,consignments,holds}/**` — 2026-11-13 — batch 4
- `apps/admin/src/app/(authed)/{delivery-actions,courier-decisions,manual-placement,nsa}/**` — 2026-11-13 — batch 5
- `apps/admin/src/app/(authed)/{dashboard,tickets,holds}/**`, `apps/admin/src/app/(authed)/orders/page.tsx`, `apps/admin/src/app/(authed)/orders/_components/orders-index.tsx` — 2026-11-13 — batch 6 (order DETAIL files are not claimed)
- `apps/admin/src/app/(authed)/inventory/**`, `apps/admin/src/app/(authed)/inventory-units/**` — 2026-11-13 — batch 7
- `apps/admin/src/app/(authed)/{seller-wallets,settlements,withdrawals,wallet-transfers,topups,reseller-store-wallets,treasury,courier-wallet,pnl,expenses,liabilities,bank-accounts,remittances,bank-changes,freight,margin,pricing,fx}/**` — 2026-11-13 — NEXT PHASE (owner's second list, the money screens, detail pages included). Screen-only; shown to the owner before each push (money rule). Not started: if Claude Code has money work in flight under these paths, say so and the claim is narrowed.
- `apps/admin/src/app/(authed)/{settings,impersonation,roles,staff,webhooks,reports}/**`, `apps/admin/src/app/(authed)/system/capacity/**` — 2026-11-13 — PHASE 3 (owner's third list, sub-pages and detail pages included). Screen-only: no permission, role or guard logic is touched. Not started: if Claude Code has work in flight under these paths, say so and the claim is narrowed.
- `apps/admin/src/app/(authed)/{leads,sellers,stores,reseller-stores,courier-accounts,delhivery,shiprocket,cost-sync,courier-escalation}/**` — 2026-11-13 — PHASE 4 (owner's fourth list, sub-pages and detail pages included). Screen-only: no courier call, credential, approval or status logic is touched.
- `apps/admin/src/app/(authed)/{account,notifications}/**`, `apps/admin/src/app/(authed)/warehouse/{pick,manifests,pickups,collapse}/**` — 2026-11-13 — the admin pages on none of the owner's lists ("if any page is missed do that too"). Screen-only. `ai/**` stays Claude Code's and is not touched.
- `apps/admin/src/middleware.ts` — 2026-11-13 — ONE change: allow Spaces images (`imgExtra`) so ticket photos show as thumbnails; asked for by Claude Code through the owner.
- Detail pages (`[id]`) under every claimed list page are part of the claim.
- Existing admin message files (`apps/admin/src/i18n/messages/*.ts`): not claimed; I add keys only, never rename or remove, and regenerate the assistant help index in the same commit.

## Claimed by Claude Code

- `apps/api/src/modules/assistant/**` — 2026-11-13 — assistant Phase D (privacy e2e, raise-a-ticket, 80% budget alert; branch `feat/assistant-phase-d`), then 2.5× billing, AI control panel, monitor
- `apps/api/test/unit/assistant-*.spec.ts`, `apps/api/test/e2e/assistant-*.e2e-spec.ts`, `apps/api/test/helpers/assistant-fixtures.ts` — 2026-11-13 — same
- `packages/ui/src/app/assistant/**` — 2026-11-13 — same (chat window)
- `packages/db/prisma/schema.prisma` — `Assistant*` models and enums ONLY — 2026-11-13 — same
- `packages/db/prisma/migrations/*_assistant_*/` — 2026-11-13 — same
- `apps/api/scripts/assistant-eval.ts`, `apps/api/eval/**` — 2026-11-13 — NEW: saved 5-language assistant eval + knowledge-gap guides
- `packages/ui/src/app/last-error/index.tsx`, `packages/ui/src/app/empty-state/index.tsx`, `packages/ui/src/app/toast/index.tsx` — additive "Ask AI why" button only — 2026-11-13 — assistant Batch A
- `apps/seller/src/app/(authed)/tickets/[id]/**`, `apps/reseller/src/app/(authed)/tickets/[id]/**` — show a ticket's photos (additive) — 2026-11-13 — assistant Batch A
- `apps/api/src/modules/**/services/*-assistant-read.service.ts` (NEW files, plus `order-assistant-read.service.ts`), and additive `exports:` lines in those modules' `*.module.ts` — 2026-11-13 — assistant Batch B (read-only lookups for charges, stock, consignments, failed deliveries, tickets, ops metrics)
- `apps/track/src/app/[awb]/**`, `apps/track/src/app/_components/parcel-assistant*`, `apps/track/src/lib/**` (additive), `apps/track/src/middleware.ts` (CSP lines only), `apps/track/src/app/dev/**` — 2026-11-13 — assistant Batch C: public "Ask about this parcel" helper on the tracking page
- `apps/admin/src/app/(authed)/ai/**`, `apps/admin/src/i18n/messages/ai.ts`, `apps/admin/src/app/dev/ai/**` — 2026-11-13 — NEW: AI control panel (billing, dashboard, conversations, controls)
- `apps/api/src/common/auth/permissions.ts`, `apps/api/src/common/auth/staff-role-presets.ts` — `assistant.*` permission keys ONLY (add, never rename) — 2026-11-13 — same
- `apps/admin/src/app/(authed)/_components/authed-shell.tsx`, `apps/admin/src/lib/page-access.ts`, `apps/admin/src/i18n/catalog.ts` — ONE added nav entry / page rule / catalogue import for /ai — 2026-11-13 — same
