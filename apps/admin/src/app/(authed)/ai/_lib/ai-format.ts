import type { BillingRow } from './ai-hooks';

const USD2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const INT = new Intl.NumberFormat('en-US');

/** USD with 2 decimals for tables. (The shared `<Money>` is INR/BDT only, so USD lives here.) */
export function usd(value: string | number): string {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? USD2.format(n) : String(value);
}
export const int = (n: number): string => INT.format(n);
/** A ratio 0-1 as a percentage. */
export const pct = (n: number | null, digits = 0): string =>
  n === null ? '—' : `${(n * 100).toFixed(digits)}%`;

/** A share already expressed 0-100 (budget used). */
export const pct100 = (n: number | null): string => (n === null ? '—' : `${n.toFixed(1)}%`);

function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const BILLING_CSV_HEAD = [
  'period',
  'requests',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'total_cost_usd',
  'assistant_cost_usd',
  'assistant_staff_cost_usd',
  'assistant_client_cost_usd',
  'assistant_member_store_cost_usd',
  'assistant_associate_cost_usd',
  'assistant_staff_requests',
  'assistant_client_requests',
  'assistant_member_store_requests',
  'assistant_associate_requests',
  'monitor_cost_usd',
  'monitor_requests',
] as const;

/** One CSV for month or day rows. Money is the stored 8-decimal string, never rounded. */
export function billingCsv(rows: readonly BillingRow[]): string {
  const lines = rows.map((r) => {
    const p = r.assistant.portals;
    return [
      r.period,
      r.total.requests,
      r.total.inputTokens,
      r.total.outputTokens,
      r.total.cacheReadTokens,
      r.total.cacheWriteTokens,
      r.total.costUsd,
      r.assistant.total.costUsd,
      p.staff.costUsd,
      p.seller.costUsd,
      p.store.costUsd,
      p.associate.costUsd,
      p.staff.requests,
      p.seller.requests,
      p.store.requests,
      p.associate.requests,
      r.monitor.costUsd,
      r.monitor.requests,
    ]
      .map(cell)
      .join(',');
  });
  return [BILLING_CSV_HEAD.join(','), ...lines].join('\r\n') + '\r\n';
}

/** Save text as a file. A BOM keeps Excel from mangling anything non-ASCII. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
