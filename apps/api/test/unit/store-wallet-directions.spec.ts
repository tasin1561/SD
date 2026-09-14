import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StoreWalletEntryDirection } from '@skydrop/db';
import { STORE_CREDIT_DIRECTIONS } from '../../src/modules/reseller-store-wallet/services/store-wallet.service';

/**
 * RS-6 — WAL-1 for STORE wallets.
 *
 * A store direction the API reads as a credit and the UI as a debit (or the
 * reverse) renders money coming in as money going out, while the ledger
 * says the opposite. Both halves are compared here AS WHOLE SETS, in both
 * directions — the mistake the seller-side check once made was asserting a
 * single value, which passes while the two disagree about every other.
 *
 * The UI half is ONE exhaustive switch in @skydrop/ui/status, read by every
 * frontend; the API half is `STORE_CREDIT_DIRECTIONS`. A direction added to
 * one and not the other fails HERE, not on somebody's screen.
 */

const UI = resolve(__dirname, '../../../../packages/ui/src/status/index.ts');

function uiStoreCredits(): Set<string> {
  const src = readFileSync(UI, 'utf8');
  const fn = src.slice(src.indexOf('export function isStoreWalletCredit'));
  const body = fn.slice(0, fn.indexOf('default:'));
  const credits = body.slice(0, body.indexOf('return true;'));
  return new Set(
    (credits.match(/StoreWalletEntryDirection\.([A-Z_]+)/g) ?? []).map((m) =>
      m.replace('StoreWalletEntryDirection.', ''),
    ),
  );
}

function uiStoreDebits(): Set<string> {
  const src = readFileSync(UI, 'utf8');
  const fn = src.slice(src.indexOf('export function isStoreWalletCredit'));
  const body = fn.slice(fn.indexOf('return true;'), fn.indexOf('default:'));
  return new Set(
    (body.match(/StoreWalletEntryDirection\.([A-Z_]+)/g) ?? []).map((m) =>
      m.replace('StoreWalletEntryDirection.', ''),
    ),
  );
}

describe('RS-6 — store wallet credits are decided ONCE, identically, on both sides', () => {
  it('the UI switch and the API set agree exactly, in both directions', () => {
    const api = [...STORE_CREDIT_DIRECTIONS].map(String).sort();
    const ui = [...uiStoreCredits()].sort();
    expect(ui.length).toBeGreaterThan(0);
    expect(ui).toEqual(api);
  });

  it('every direction is placed by the UI switch exactly once', () => {
    const credits = uiStoreCredits();
    const debits = uiStoreDebits();
    const all = Object.values(StoreWalletEntryDirection) as string[];
    for (const d of all) {
      expect([d, credits.has(d) !== debits.has(d)]).toEqual([d, true]);
    }
    expect([...credits, ...debits].sort()).toEqual([...all].sort());
  });

  it('the two money-in flows of this release are credits, the two money-out flows debits', () => {
    expect(STORE_CREDIT_DIRECTIONS.has(StoreWalletEntryDirection.SELLER_TOPUP)).toBe(true);
    expect(STORE_CREDIT_DIRECTIONS.has(StoreWalletEntryDirection.TOPUP)).toBe(true);
    expect(STORE_CREDIT_DIRECTIONS.has(StoreWalletEntryDirection.SELLER_PAYOUT)).toBe(false);
    expect(STORE_CREDIT_DIRECTIONS.has(StoreWalletEntryDirection.WITHDRAWAL)).toBe(false);
  });

  it('the seller-side twins are registered on both sides (WAL-1)', () => {
    const api = readFileSync(
      resolve(__dirname, '../../src/modules/seller-wallet/services/wallet.service.ts'),
      'utf8',
    );
    const set = api.slice(
      api.indexOf('CREDIT_DIRECTIONS: ReadonlySet'),
      api.indexOf(']);', api.indexOf('CREDIT_DIRECTIONS: ReadonlySet')),
    );
    // Paid back by the store: a credit. Moved to the store: a debit.
    expect(set).toContain('WalletEntryDirection.STORE_PAYOUT_IN');
    expect(set).not.toContain('WalletEntryDirection.STORE_TOPUP_OUT');
  });
});
