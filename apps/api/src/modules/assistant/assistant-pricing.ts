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
