# Agent locks

Two agents push to `main`: **cloud Claude** and **Claude Code** (local). Before every edit and
after every `git pull`, read this file from `origin/main`. Never create, edit, move or delete
anything under a path the OTHER agent has claimed. Claim your own paths here, in a small commit
pushed to `main`, before starting new work; remove the claim when that work is merged.
Full protocol: CLAUDE.md → "Two agents on this repo".

One line per claim: `path or glob — date — what for`.

## Claimed by cloud Claude

_(none yet)_

## Claimed by Claude Code

- `apps/api/src/modules/assistant/**` — 2026-11-13 — assistant Phase D (privacy e2e, raise-a-ticket, 80% budget alert; branch `feat/assistant-phase-d`), then 2.5× billing, AI control panel, monitor
- `apps/api/test/unit/assistant-*.spec.ts`, `apps/api/test/e2e/assistant-*.e2e-spec.ts`, `apps/api/test/helpers/assistant-fixtures.ts` — 2026-11-13 — same
- `packages/ui/src/app/assistant/**` — 2026-11-13 — same (chat window)
- `packages/db/prisma/schema.prisma` — `Assistant*` models and enums ONLY — 2026-11-13 — same
- `packages/db/prisma/migrations/*_assistant_*/` — 2026-11-13 — same
- `apps/seller/src/app/(authed)/orders/_components/order-detail.tsx`, `apps/seller/src/app/(authed)/orders/_components/detail/**`, `apps/seller/src/i18n/messages/orderPage.ts`, `apps/seller/src/tests/address-needs-fix.test.ts` — 2026-11-13 — client order header tidy-up + item price (merging now; claim removed once green)
- `apps/admin/src/app/(authed)/orders/_components/order-detail.tsx`, `apps/admin/src/app/(authed)/orders/_components/recipient-card.tsx` — 2026-11-13 — "address needs a fix" only below score 60 (merging now; claim removed once green)
- `packages/ui/src/app/address-check/index.tsx` — 2026-11-13 — adds the `addressNeedsFix` / `ADDRESS_FIX_BELOW_SCORE` export only (merging now; claim removed once green)
