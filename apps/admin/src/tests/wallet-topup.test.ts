import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wallet top-up — the only way money enters a wallet other than COD.
 *
 * Eleven endpoints across three controllers shipped with no caller on
 * either side: a seller could not claim a transfer and no operator could
 * accept one. Meanwhile order charges, RTO fees and inbound freight all
 * debit the wallet, and the writer deliberately permits a negative
 * balance — so a seller who went under had no way to settle and nobody
 * could take their money if they wired it.
 *
 * The property that matters most is WAL-2: submitting is a CLAIM, not a
 * payment. If the seller UI ever implies otherwise, sellers will spend
 * against a balance that does not exist yet.
 */

const R = (p: string): string => readFileSync(join(__dirname, p), 'utf8');

const SELLER_CARD = '../../../seller/src/app/(authed)/wallet/_components/topup-card.tsx';
const SELLER_PAGE = '../../../seller/src/app/(authed)/wallet/page.tsx';
const SELLER_HOOKS = '../../../seller/src/lib/api-hooks.ts';
const ADMIN_INDEX = '../app/(authed)/topups/_components/topups-index.tsx';
const ADMIN_HOOKS = '../lib/ops-hooks.ts';
const ADMIN_NAV = '../app/(authed)/_components/authed-shell.tsx';
const ADMIN_GATE = '../lib/page-access.ts';
const SUBMIT_DTO = '../../../api/src/modules/wallet-topup/dto/wallet-topup.dto.ts';

describe('WAL-2 — the seller is never told the money arrived', () => {
  const src = R(SELLER_CARD);

  it('the wording asks to RECORD a top-up, it never promises credit', () => {
    // The verb is the whole point (WAL-2): a seller is telling us what
    // they sent, not adding money. The negative list is what the copy
    // must never drift into.
    expect(src).toContain('Record a top-up');
    expect(src).not.toMatch(/Add funds|Top up now|credited instantly/i);
  });

  it('the success message says recorded, not credited', () => {
    expect(src).toContain('Top-up recorded');
    expect(src).toContain('once we see it on our statement');
  });

  it('submitting does NOT invalidate the balance, because nothing moved', () => {
    // Invalidating the balance would make the page refetch and show the
    // same number, which reads as the credit having silently failed.
    const hooks = R(SELLER_HOOKS);
    const hook = hooks.slice(hooks.indexOf('export function useSubmitTopup('));
    expect(hook.slice(0, 700)).toContain("['seller-wallet', 'topups']");
    expect(hook.slice(0, 700)).not.toContain("'balances'");
  });
});

describe('a claim without evidence cannot be submitted', () => {
  it('the form requires a reference OR a receipt, mirroring the server', () => {
    // Without one there is nothing to match against the statement, so
    // the claim could never be resolved either way.
    const src = R(SELLER_CARD);
    expect(src).toContain("transactionRef.trim() !== '' || proof !== null");
    expect(src).toMatch(/canSubmit =[\s\S]{0,120}hasReference/);
  });

  it('the server agrees that both are optional individually', () => {
    // If the DTO ever made one of them required, the form's OR would be
    // wrong in a way no client-side test would notice.
    const dto = R(SUBMIT_DTO);
    const block = dto.slice(dto.indexOf('class SubmitTopupDto'));
    expect(block).toMatch(/@IsOptional\(\)[\s\S]{0,120}transactionRef\?/);
    expect(block).toMatch(/@IsOptional\(\)[\s\S]{0,120}proofSpacesKey\?/);
  });
});

describe('the admin side can actually accept one', () => {
  const src = R(ADMIN_INDEX);

  it('the page exists, is navigable and is gated', () => {
    expect(R(ADMIN_NAV)).toContain("href: '/topups'");
    expect(R(ADMIN_GATE)).toContain("['/topups', 'money.view']");
  });

  it('accept and reject are gated on the review permission, not page view', () => {
    // The page opens on money.view; crediting a wallet needs more.
    expect(src).toContain("usePermission('money.topups.review')");
    expect(src).toContain('mayReview');
  });

  it('accepting says plainly that it moves money', () => {
    expect(src).toContain('Credit the wallet');
    expect(src).toMatch(/adds the money to the seller/);
  });

  it('a rejection carries a reason the seller can act on', () => {
    // The DTO requires ≥5 chars; mirrored so the operator is told first.
    expect(src).toContain('note.trim().length < 5');
    expect(src).toContain('the seller sees your reason');
  });

  it('the receipt link is fetched on demand, not listed', () => {
    // Presigned URLs are short-lived; minting one per row on load would
    // leak them into a payload and expire before anyone clicked.
    expect(src).toContain('useTopupProofUrl');
    expect(src).toContain('onViewProof');
  });

  it('accepting invalidates the wallet, because it credited one', () => {
    const hooks = R(ADMIN_HOOKS);
    const hook = hooks.slice(hooks.indexOf('export function useAcceptTopup('));
    expect(hook.slice(0, 900)).toContain("['admin-topups']");
    expect(hook.slice(0, 900)).toContain("['admin-wallet']");
  });
});

describe('the seller card is reachable', () => {
  it('is mounted on the wallet page, before withdrawals', () => {
    const page = R(SELLER_PAGE);
    expect(page).toContain('<TopupCard');
    // Money in before money out: a seller whose balance is short needs
    // the top-up, not the payout form. Still true now the two are tabs
    // rather than stacked cards — the tab order carries it.
    expect(page.indexOf("['topups'")).toBeLessThan(page.indexOf("['payouts'"));
    expect(page.indexOf('<TopupCard')).toBeLessThan(page.indexOf('<WithdrawalsCard'));
  });

  it('is hidden from roles that cannot top up', () => {
    expect(R(SELLER_CARD)).toContain("can(identity, 'wallet.topup')");
  });
});
