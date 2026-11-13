import { Prisma } from '@skydrop/db';

/**
 * Claude Haiku 5.5 has TWO rate cards chosen by the size of the PROMPT:
 * 100K tokens or fewer is $0.10 in / $0.50 out per million; above that
 * it is 5x ($0.50 / $2.50). Cache reads cost 0.1x the input rate and a
 * 5-minute cache write 1.25x. The assistant keeps every request under
 * 100K (history is windowed), but the card is still picked per response
 * from what the API reports, so a request that did cross is billed — and
 * budgeted — at what it really cost.
 */
export const PROMPT_TOKEN_CARD_BOUNDARY = 100_000;

const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);
const PER_MILLION = D('1000000');

const CARDS = {
  standard: { input: D('0.10'), output: D('0.50') },
  long: { input: D('0.50'), output: D('2.50') },
} as const;

export interface AssistantUsageTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** USD for one model response. Thinking is inside `outputTokens`. */
export function assistantCostUsd(u: AssistantUsageTokens): Prisma.Decimal {
  const promptTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const card = promptTokens > PROMPT_TOKEN_CARD_BOUNDARY ? CARDS.long : CARDS.standard;
  const input = D(String(u.inputTokens)).mul(card.input);
  const cacheRead = D(String(u.cacheReadTokens)).mul(card.input).mul(D('0.1'));
  const cacheWrite = D(String(u.cacheWriteTokens)).mul(card.input).mul(D('1.25'));
  const output = D(String(u.outputTokens)).mul(card.output);
  return input.add(cacheRead).add(cacheWrite).add(output).div(PER_MILLION);
}

/**
 * Owner, 2026-11-13: every AI cost is STORED and SHOWN at 2.5x what
 * Anthropic charges ("if haiku is using 1$ in our system you will show and
 * store as 2.5$"). Fixed, never a setting, and never labelled on any
 * screen. Only this billed figure is stored (`assistant_usage.cost_usd`).
 *
 * The monthly caps ($80 assistant, $20 monitor) stay in REAL spend: budget
 * code converts back with `realFromBilledUsd` before comparing, so the
 * assistant still stops after $80 of real spend (shown as $200).
 */
export const ASSISTANT_BILLING_MULTIPLIER = D('2.5');

/** What is stored and shown for one model response. */
export function assistantBilledUsd(u: AssistantUsageTokens): Prisma.Decimal {
  return assistantCostUsd(u).mul(ASSISTANT_BILLING_MULTIPLIER);
}

/** Stored (billed) USD back to real Anthropic spend — for cap checks only. */
export function realFromBilledUsd(billed: Prisma.Decimal): Prisma.Decimal {
  return billed.div(ASSISTANT_BILLING_MULTIPLIER);
}

/** Real USD (a cap, a real spend) as it is shown and stored. */
export function billedFromRealUsd(real: Prisma.Decimal | number): Prisma.Decimal {
  return new Prisma.Decimal(real).mul(ASSISTANT_BILLING_MULTIPLIER);
}

/**
 * The Message Batches API charges 50% of the normal price for both input
 * and output. The overnight monitor is the only batch user.
 */
export const BATCH_DISCOUNT = D('0.5');

/** REAL USD for one batched response: the normal price, halved. */
export function assistantBatchCostUsd(u: AssistantUsageTokens): Prisma.Decimal {
  return assistantCostUsd(u).mul(BATCH_DISCOUNT);
}

/** What the monitor stores and shows for one batched response (real x 2.5). */
export function assistantBatchBilledUsd(u: AssistantUsageTokens): Prisma.Decimal {
  return assistantBatchCostUsd(u).mul(ASSISTANT_BILLING_MULTIPLIER);
}
