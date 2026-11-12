import { describe, expect, it } from 'vitest';
import { CATALOGS } from '@/i18n/catalog';
import {
  ALL_STATUSES,
  nextMilestoneKey,
  summaryFor,
  type SummaryInput,
} from '@/app/(authed)/orders/_components/detail/summary';

const base: SummaryInput = {
  status: 'CONFIRMED',
  paymentMode: 'COD',
  codAmountInr: '1050.00',
  nextMilestoneKey: 'picked',
  hasBanner: false,
  addressNeedsFix: false,
  collectableMismatch: false,
};

/** Statuses where "Next, we…" would be a promise nobody is keeping. */
const NEVER_NEXT = [
  'CANCELLED',
  'CANCELLED_BY_ADMIN',
  'REJECTED',
  'REJECTED_BY_CUSTOMER',
  'REJECTED_NDR',
  'DELIVERY_FAILED',
  'RTO_INITIATED',
  'RTO_IN_TRANSIT',
  'RTO_RECEIVED',
  'RTO_RESTOCKED',
  'RTO_DAMAGED',
  'LOST_IN_TRANSIT',
  'AWAITING_SELLER_DECISION',
  'OUT_OF_STOCK',
  'DELIVERED',
];

describe('order page summary sentence', () => {
  it('covers all 30 statuses with a sentence in both languages', () => {
    expect(ALL_STATUSES).toHaveLength(30);
    for (const status of ALL_STATUSES) {
      const s = summaryFor({ ...base, status });
      expect(s.where, status).not.toBeNull();
      const key = s.where as keyof typeof CATALOGS.en;
      expect(CATALOGS.en[key], `${status} en`).toBeTruthy();
      expect(CATALOGS.bn[key], `${status} bn`).toBeTruthy();
    }
  });

  it('never says "Next" for a status that is off the forward path', () => {
    for (const status of NEVER_NEXT) {
      for (const nextMilestoneKey of ['picked', 'delivered', 'in_transit']) {
        expect(summaryFor({ ...base, status, nextMilestoneKey }).next, status).toBeNull();
      }
    }
  });

  it('says what comes next on the forward path, e.g. confirmed then picking', () => {
    const s = summaryFor(base);
    expect(s.next).toBe('orderPage.sum.next.picked');
    expect(CATALOGS.en['orderPage.sum.next.picked']).toBe('Next, we pick it from the shelf.');
    expect(CATALOGS.en['orderPage.sum.where.CONFIRMED']).toBe('Confirmed by phone.');
  });

  it('drops the "next" sentence while a banner is showing', () => {
    expect(summaryFor({ ...base, hasBanner: true }).next).toBeNull();
  });

  it('has no next sentence when the tracker has nothing to come', () => {
    expect(summaryFor({ ...base, nextMilestoneKey: null }).next).toBeNull();
  });

  it('states the money from the order: COD collects, prepaid is paid', () => {
    expect(summaryFor(base).collectInr).toBe('1050.00');
    expect(summaryFor(base).prepaid).toBe(false);
    const prepaid = summaryFor({ ...base, paymentMode: 'PREPAID', codAmountInr: null });
    expect(prepaid.prepaid).toBe(true);
    expect(prepaid.collectInr).toBeNull();
    // COD with no figure on the order: omit rather than guess.
    const missing = summaryFor({ ...base, codAmountInr: null });
    expect(missing.collectInr).toBeNull();
    expect(missing.prepaid).toBe(false);
  });

  it('says nothing about collecting money once nothing is going to the door', () => {
    for (const status of NEVER_NEXT.filter(
      (x) => x !== 'AWAITING_SELLER_DECISION' && x !== 'OUT_OF_STOCK',
    )) {
      const s = summaryFor({ ...base, status });
      expect(s.collectInr, status).toBeNull();
      expect(s.prepaid, status).toBe(false);
    }
  });

  it('carries the two warning flags through', () => {
    const s = summaryFor({ ...base, addressNeedsFix: true, collectableMismatch: true });
    expect(s.addressFix).toBe(true);
    expect(s.mismatch).toBe(true);
  });

  it('says nothing for a status it does not know', () => {
    expect(summaryFor({ ...base, status: 'SOMETHING_NEW' }).where).toBeNull();
  });

  it('finds the next milestone after the current one, skipping skipped rungs', () => {
    expect(
      nextMilestoneKey([
        { key: 'order_received', state: 'DONE' },
        { key: 'call_confirmed', state: 'CURRENT' },
        { key: 'picked', state: 'PENDING' },
      ]),
    ).toBe('picked');
    expect(
      nextMilestoneKey([
        { key: 'a', state: 'CURRENT' },
        { key: 'ready_to_dispatch', state: 'SKIPPED' },
        { key: 'dispatched', state: 'PENDING' },
      ]),
    ).toBe('dispatched');
    expect(nextMilestoneKey([{ key: 'a', state: 'DONE' }])).toBeNull();
  });
});
