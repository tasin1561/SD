import { describe, expect, it } from 'vitest';
import {
  InboundFreightMode,
  ResellerCreditStatus,
  ResellerStoreStatus,
  StoreWalletEntryDirection,
  TopupRequestStatus,
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import {
  freightModeExplainer,
  freightModeWords,
  journeyOwnerLabel,
  resellerCreditStatusLabel,
  resellerStoreStatusLabel,
  storeWalletDirectionLabel,
  topupStatusLabel,
  walletDirectionLabel,
  withdrawalStatusLabel,
} from '@skydrop/ui/status';

/*
  The seller console's money vocabularies are WORDS only. These pin that English
  is untouched when no locale is passed, and that every enum value has a Bangla
  word with Western numerals.
*/
const BENGALI_DIGIT = /[০-৯]/;
const hasBengali = (s: string): boolean => /[ঀ-৿]/.test(s) && !BENGALI_DIGIT.test(s);

describe('money vocabularies', () => {
  it('keep their English with no locale', () => {
    expect(walletDirectionLabel(WalletEntryDirection.COD_COLLECTION)).toBe('COD collected');
    expect(topupStatusLabel(TopupRequestStatus.PENDING, 'payer')).toBe(
      'Waiting for Skydrop to see it',
    );
    expect(withdrawalStatusLabel(WithdrawalRequestStatus.APPROVED, 'seller')).toBe(
      'Payment in process',
    );
    expect(freightModeWords(InboundFreightMode.PAY_LATER, 'SELLER')).toBe('Pay as it sells');
  });

  it('give every value a Bangla word', () => {
    const all: string[] = [];
    for (const v of Object.values(WalletEntryDirection)) all.push(walletDirectionLabel(v, 'bn'));
    for (const v of Object.values(StoreWalletEntryDirection))
      all.push(storeWalletDirectionLabel(v, 'X', 'bn'));
    for (const v of Object.values(ResellerStoreStatus)) all.push(resellerStoreStatusLabel(v, 'bn'));
    for (const v of Object.values(ResellerCreditStatus))
      all.push(resellerCreditStatusLabel(v, 'bn'));
    for (const a of ['payer', 'staff'] as const)
      for (const v of Object.values(TopupRequestStatus)) all.push(topupStatusLabel(v, a, 'bn'));
    for (const a of ['seller', 'staff'] as const)
      for (const v of Object.values(WithdrawalRequestStatus))
        all.push(withdrawalStatusLabel(v, a, 'bn'));
    for (const a of ['STAFF', 'SELLER'] as const)
      for (const v of Object.values(InboundFreightMode)) {
        all.push(freightModeWords(v, a, 'bn'), freightModeExplainer(v, a, 'bn'));
      }
    for (const o of ['SKYDROP', 'SELLER', 'STORE', 'COURIER'] as const)
      all.push(journeyOwnerLabel(o, 'bn'));
    for (const w of all) expect(hasBengali(w) || w === 'Skydrop', w).toBe(true);
  });
});
