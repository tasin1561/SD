-- Owner, 2026-11-13: every AI cost is stored and shown at 2.5x the real
-- Anthropic cost (apps/api/src/modules/assistant/assistant-pricing.ts,
-- ASSISTANT_BILLING_MULTIPLIER). From this release the chat service writes
-- the billed figure; this converts every row written before it, ONCE (a
-- migration runs exactly once per database), so all months are on one basis.
-- The monthly caps stay in real spend: the budget service divides back.
-- Data only; no schema change.

UPDATE "assistant_usage" SET "cost_usd" = "cost_usd" * 2.5;

-- Budget-alert rows record the spend and budget they were raised at; store
-- them on the same billed basis as everything else.
UPDATE "assistant_budget_alerts"
SET "spent_usd" = "spent_usd" * 2.5,
    "budget_usd" = "budget_usd" * 2.5;
