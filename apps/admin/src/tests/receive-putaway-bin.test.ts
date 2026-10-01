import { describe, expect, it } from 'vitest';
import {
  buildReceiptLines,
  type ReceiveLineRow,
} from '@/app/(authed)/warehouse/receive/_components/receive-lines';

/**
 * BIN-1 / FE-2 — the receive bench does not decide whether a bin is
 * required.
 *
 * The bench refused any line with `qty > 0` and no putaway bin,
 * unconditionally and with no reference to the warehouse. The SERVER
 * does not work that way: `BinPolicyService.resolvePutawayBin` is the
 * ONE reader of `binTrackingEnabled`, and with tracking OFF it answers
 * `requestedBinId ?? floorBinId` — a bin is honoured when given and not
 * demanded when it is absent. So a warehouse that does not track
 * locations (the default) could not record a receipt line at all from
 * this screen, because the client was mirroring a server policy — which
 * FE-2 forbids — and mirroring the opposite of it.
 *
 * What is pinned here is the ABSENCE of that decision: a bin travels
 * through when one was chosen and is omitted when it was not, in both
 * directions, and nothing on this side ever refuses over it.
 */

const ROWS: readonly ReceiveLineRow[] = [
  { id: 'line-1', skuCode: 'KUR-RED-M' },
  { id: 'line-2', skuCode: 'KUR-BLU-L' },
];

describe('buildReceiptLines — the bin is the server’s question (BIN-1 / FE-2)', () => {
  it('records a counted line with NO bin — the case a non-tracking warehouse is in', () => {
    const built = buildReceiptLines(ROWS, { 'line-1': '6' }, {}, {});
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines).toHaveLength(1);
    expect(built.lines[0]).toEqual({ lineId: 'line-1', receivedQty: 6, damagedQty: 0 });
    // Omitted, not sent empty: `''` is not a bin id, and an absent bin
    // is exactly the question `resolvePutawayBin` exists to answer.
    expect(built.lines[0]).not.toHaveProperty('putawayBinId');
  });

  it('passes a chosen bin straight through — honoured in either mode', () => {
    const built = buildReceiptLines(ROWS, { 'line-2': '3' }, {}, { 'line-2': 'bin-floor' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]).toEqual({
      lineId: 'line-2',
      receivedQty: 3,
      damagedQty: 0,
      putawayBinId: 'bin-floor',
    });
  });

  it('a whitespace-only bin is the same as no bin, not an empty one', () => {
    const built = buildReceiptLines(ROWS, { 'line-1': '2' }, {}, { 'line-1': '   ' });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]).not.toHaveProperty('putawayBinId');
  });

  it('records several binless lines at once — nothing accumulates a refusal', () => {
    const built = buildReceiptLines(ROWS, { 'line-1': '6', 'line-2': '4' }, { 'line-2': '1' }, {});
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines).toEqual([
      { lineId: 'line-1', receivedQty: 6, damagedQty: 0 },
      { lineId: 'line-2', receivedQty: 4, damagedQty: 1 },
    ]);
  });
});

describe('buildReceiptLines — what it DOES still decide', () => {
  it('skips a line nobody typed into rather than sending a zero', () => {
    const built = buildReceiptLines(ROWS, { 'line-1': '5' }, {}, {});
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines.map((l) => l.lineId)).toEqual(['line-1']);
  });

  it('refuses a received quantity that is not a number, naming the SKU', () => {
    const built = buildReceiptLines(ROWS, { 'line-1': 'six' }, {}, {});
    expect(built).toEqual({ ok: false, error: 'Invalid received qty on line KUR-RED-M' });
  });

  it('refuses a negative damaged quantity, naming the SKU', () => {
    const built = buildReceiptLines(ROWS, { 'line-2': '4' }, { 'line-2': '-1' }, {});
    expect(built).toEqual({ ok: false, error: 'Invalid damaged qty on line KUR-BLU-L' });
  });

  it('refuses a submission with nothing counted on it', () => {
    const built = buildReceiptLines(ROWS, {}, {}, {});
    expect(built).toEqual({
      ok: false,
      error: 'Nothing to record — fill in at least one line.',
    });
  });
});
