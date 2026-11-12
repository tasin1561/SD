import type Anthropic from '@anthropic-ai/sdk';
import type { StoredMessage } from './services/assistant-store.service';

/**
 * Every request must stay under 100K prompt tokens (above that the whole
 * prompt is billed at 5x). We budget 60K for history — the rest is the
 * system prompt, the tools and the answer — and the estimator below
 * deliberately OVER-counts.
 */
export const HISTORY_TOKEN_BUDGET = 60_000;

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  // ~3 chars per token for English and JSON; ~1 token per non-ASCII
  // character (Bangla and Devanagari tokenise at roughly that). The newer
  // tokenizer counts ~30% more than older ones, hence the extra 1.3.
  return Math.ceil((ascii / 3 + other) * 1.3);
}

/**
 * Where the replayed window starts: the first message of the OLDEST turn
 * (a turn begins at a question the person typed) whose tail, together
 * with every later turn, fits the budget. Never splits a turn — a
 * tool_use must keep its tool_result — and never drops the current one.
 */
export function windowStart(rows: readonly StoredMessage[]): number {
  let total = 0;
  let start = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    total += estimateTokens(rows[i]?.content);
    if (total > HISTORY_TOKEN_BUDGET) break;
    start = i;
  }
  // Snap forward to a turn boundary.
  let s = start;
  while (s < rows.length && rows[s]?.isQuestion !== true) s++;
  if (s >= rows.length) {
    // The last turn alone is over budget: still send it whole.
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.isQuestion === true) return i;
    return 0;
  }
  return s;
}

type Block = { type?: string } & Record<string, unknown>;

/**
 * The stored rows as API messages.
 *
 * History is append-only and replayed UNMODIFIED — thinking blocks
 * included — as long as the window starts at the first row. Once the
 * window has moved forward (old turns dropped), the prefix every earlier
 * thinking block was bound to no longer exists, and sending one would be
 * a 400 on the history-editing check. So from that point the thinking
 * blocks of the turns BEFORE the current question are left out of the
 * COPY we send. The stored rows are never touched, and the current turn
 * (whose blocks were produced inside this same window) keeps its own.
 */
export function toApiMessages(
  rows: readonly StoredMessage[],
  start: number,
  currentTurnStart: number,
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const role = row.role === 'USER' ? 'user' : 'assistant';
    let content = row.content as Anthropic.MessageParam['content'];
    if (start > 0 && i < currentTurnStart && Array.isArray(content)) {
      const kept = (content as unknown as Block[]).filter(
        (b) => b.type !== 'thinking' && b.type !== 'redacted_thinking',
      );
      // An assistant turn that was only thinking has nothing to send.
      if (kept.length === 0) continue;
      content = kept as unknown as Anthropic.MessageParam['content'];
    }
    out.push({ role, content });
  }
  return out;
}
