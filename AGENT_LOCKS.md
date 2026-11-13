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
