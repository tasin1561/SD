import { describe, expect, it } from 'vitest';
import {
  ResellerCreditStatus,
  ResellerStoreStatus,
  StoreAddressChangeStatus,
  StoreOrderRequestStatus,
  StoreWalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  resellerCreditStatusLabel,
  resellerStoreStatusLabel,
  storeAddressChangeStatusLabel,
  storeOrderRequestStatusLabel,
  storeWalletDirectionLabel,
  withdrawalStatusLabel,
} from '@skydrop/ui/status';

const ENGLISH_ONLY = /^[\x20-\x7e’—]+$/;

describe('store status labels: English is unchanged by the locale parameter', () => {
  it('storeAddressChangeStatusLabel', () => {
    expect(storeAddressChangeStatusLabel(StoreAddressChangeStatus.PENDING)).toBe(
      'Waiting on client staff',
    );
    expect(storeAddressChangeStatusLabel(StoreAddressChangeStatus.SUPERSEDED)).toBe(
      'Client staff corrected it themselves',
    );
    expect(storeAddressChangeStatusLabel(StoreAddressChangeStatus.FAILED)).toBe(
      'Could not be applied',
    );
  });
  it('storeOrderRequestStatusLabel', () => {
    expect(storeOrderRequestStatusLabel(StoreOrderRequestStatus.EXECUTED)).toBe('Done');
    expect(storeOrderRequestStatusLabel(StoreOrderRequestStatus.FAILED)).toBe('Could not be done');
  });
  it('resellerStoreStatusLabel and resellerCreditStatusLabel', () => {
    expect(resellerStoreStatusLabel(ResellerStoreStatus.PENDING_SELLER_APPROVAL)).toBe(
      'awaiting approval',
    );
    expect(resellerCreditStatusLabel(ResellerCreditStatus.REVERSED)).toBe('taken back');
    expect(resellerCreditStatusLabel(ResellerCreditStatus.SKIPPED)).toBe('not credited');
  });
  it('withdrawalStatusLabel', () => {
    expect(withdrawalStatusLabel(WithdrawalRequestStatus.APPROVED)).toBe('Approved');
    expect(withdrawalStatusLabel(WithdrawalRequestStatus.APPROVED, 'seller')).toBe(
      'Payment in process',
    );
    expect(withdrawalStatusLabel(WithdrawalRequestStatus.REJECTED, 'seller')).toBe('Declined');
  });
  it('storeWalletDirectionLabel, with and without a seller', () => {
    const d = StoreWalletEntryDirection;
    expect(storeWalletDirectionLabel(d.SELLER_TOPUP)).toBe('Topped up by the client');
    expect(storeWalletDirectionLabel(d.SELLER_PAYOUT)).toBe('Paid by the client (recorded)');
    expect(storeWalletDirectionLabel(d.TRANSFER_PRICE)).toBe(
      'Goods at the client’s transfer price',
    );
    expect(storeWalletDirectionLabel(d.DISPUTE_SETTLEMENT_IN)).toBe(
      'Dispute settled — paid by the client',
    );
    expect(storeWalletDirectionLabel(d.DISPUTE_SETTLEMENT_OUT, 'Dhaka Threads')).toBe(
      'Dispute settled — paid to Dhaka Threads',
    );
    expect(storeWalletDirectionLabel(d.TOPUP)).toBe('Top-up received');
  });
});

describe('store status labels: Bangla', () => {
  it('returns the given strings', () => {
    expect(storeAddressChangeStatusLabel(StoreAddressChangeStatus.PENDING, 'bn')).toBe(
      'ক্লায়েন্ট স্টাফের অপেক্ষায়',
    );
    expect(storeOrderRequestStatusLabel(StoreOrderRequestStatus.EXECUTED, 'bn')).toBe('সম্পন্ন');
    expect(resellerStoreStatusLabel(ResellerStoreStatus.PAUSED, 'bn')).toBe('স্থগিত');
    expect(resellerCreditStatusLabel(ResellerCreditStatus.DUE, 'bn')).toBe('প্রদেয়');
    expect(withdrawalStatusLabel(WithdrawalRequestStatus.PAID, 'seller', 'bn')).toBe('পরিশোধিত');
  });

  it('covers every enum member with a non-empty, non-English string', () => {
    const cases: [string, string[]][] = [
      [
        'address',
        Object.values(StoreAddressChangeStatus).map((s) => storeAddressChangeStatusLabel(s, 'bn')),
      ],
      [
        'orderRequest',
        Object.values(StoreOrderRequestStatus).map((s) => storeOrderRequestStatusLabel(s, 'bn')),
      ],
      ['store', Object.values(ResellerStoreStatus).map((s) => resellerStoreStatusLabel(s, 'bn'))],
      [
        'credit',
        Object.values(ResellerCreditStatus).map((s) => resellerCreditStatusLabel(s, 'bn')),
      ],
      [
        'withdrawalStaff',
        Object.values(WithdrawalRequestStatus).map((s) => withdrawalStatusLabel(s, 'staff', 'bn')),
      ],
      [
        'withdrawalSeller',
        Object.values(WithdrawalRequestStatus).map((s) => withdrawalStatusLabel(s, 'seller', 'bn')),
      ],
      [
        'wallet',
        Object.values(StoreWalletEntryDirection).map((s) =>
          storeWalletDirectionLabel(s, 'Acme', 'bn'),
        ),
      ],
    ];
    for (const [, labels] of cases) {
      expect(labels.length).toBeGreaterThan(0);
      for (const l of labels) {
        expect(l.trim()).not.toBe('');
        expect(l).not.toMatch(ENGLISH_ONLY);
      }
    }
  });

  it('withdrawal staff and seller differ for PENDING/APPROVED/REJECTED, agree for PAID', () => {
    const w = WithdrawalRequestStatus;
    for (const s of [w.PENDING, w.APPROVED, w.REJECTED]) {
      expect(withdrawalStatusLabel(s, 'staff', 'bn')).not.toBe(
        withdrawalStatusLabel(s, 'seller', 'bn'),
      );
    }
    expect(withdrawalStatusLabel(w.PAID, 'staff', 'bn')).toBe(
      withdrawalStatusLabel(w.PAID, 'seller', 'bn'),
    );
  });

  it('puts the company name into the four interpolating wallet cases, in both languages', () => {
    const d = StoreWalletEntryDirection;
    for (const dir of [
      d.SELLER_TOPUP,
      d.SELLER_PAYOUT,
      d.TRANSFER_PRICE,
      d.DISPUTE_SETTLEMENT_IN,
      d.DISPUTE_SETTLEMENT_OUT,
    ]) {
      expect(storeWalletDirectionLabel(dir, 'Dhaka Threads')).toContain('Dhaka Threads');
      expect(storeWalletDirectionLabel(dir, 'Dhaka Threads', 'bn')).toContain('Dhaka Threads');
    }
    expect(storeWalletDirectionLabel(d.SELLER_TOPUP, 'X', 'bn')).toBe('X টপ-আপ করেছে');
    expect(storeWalletDirectionLabel(d.SELLER_TOPUP, undefined, 'bn')).toBe(
      'ক্লায়েন্ট টপ-আপ করেছে',
    );
  });
});
