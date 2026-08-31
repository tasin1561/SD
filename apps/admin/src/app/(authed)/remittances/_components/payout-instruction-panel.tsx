'use client';

import { useState, type ReactElement } from 'react';
import { Button, ErrorNote } from '@skydrop/ui/components';
import { Money } from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useRevealSellerBankAccount, useSellerDetail } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { useTreasuryOverview } from '@/lib/ops-hooks';

/**
 * WHERE the money goes, and WHETHER we can send it — on the screen that
 * records the payment.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The remittance form asked which of OUR accounts the money left and
 * never showed the seller's. An operator recording a payout therefore
 * had no destination in front of them: they had to leave, find the
 * seller, come back, and hope they had copied the right row. The screen
 * that takes the payment is the screen that should show where it goes.
 *
 * The account number is MASKED here. The full one is a POST behind an
 * audited reveal — reading it is a deliberate act at the moment of
 * typing a transfer, not a side effect of opening a modal.
 *
 * ── AND WHETHER A TRANSFER IS NEEDED FIRST ───────────────────────────
 * A payout leaves one of our accounts, and that account may not hold
 * enough. The operator could only find that out by failing. So every
 * account in the destination currency is listed with what it holds, and
 * the panel says plainly when none of them covers the amount — which is
 * the moment to move money between our own accounts rather than to
 * discover it halfway through a bank transfer.
 *
 * Balances are the treasury's own figures (TRE-1: summed from
 * `bank_entries`, never cached), so this cannot drift from the ledger.
 */
export function PayoutInstructionPanel({
  sellerId,
  currency,
  amount,
}: {
  readonly sellerId: string;
  readonly currency: 'INR' | 'BDT';
  /** What is about to leave, in `currency`. Blank while nothing is typed. */
  readonly amount: string;
}): ReactElement {
  // This page is gated on `money.view`, which is WEAKER than either of
  // these. Without the checks, an operator who may record a remittance
  // but not read the treasury or reveal an account number would get a
  // 403 on open — punished for loading a page. Cosmetic per FE-2: the
  // server still refuses either call regardless of what is rendered.
  const mayReadTreasury = usePermission('money.treasury.view');
  const mayReveal = usePermission('sellers.bank_account.reveal');
  const mayReadSeller = usePermission('sellers.view');

  const seller = useSellerDetail(mayReadSeller ? sellerId : '');
  const treasury = useTreasuryOverview(mayReadTreasury);
  const reveal = useRevealSellerBankAccount(sellerId);
  const [revealed, setRevealed] = useState<string | null>(null);

  const s = seller.data;
  const bankMissing =
    s !== undefined &&
    (s.bankName === null || s.bankAccountName === null || s.bankAccountNumberMasked === null);

  const accounts = (treasury.data?.accounts ?? []).filter((a) => a.currency === currency);
  const wanted = Number(amount);
  const haveWanted = Number.isFinite(wanted) && wanted > 0;
  // Whether ONE account can cover it. A payout leaves a single account,
  // so the sum across accounts is the wrong test — three accounts each
  // holding a third of the amount cannot make this transfer.
  const covering = haveWanted ? accounts.filter((a) => Number(a.total) >= wanted) : accounts;
  const shortfall = haveWanted && accounts.length > 0 && covering.length === 0;

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 text-xs space-y-3">
      <div>
        <div className="text-text-faint uppercase tracking-wide text-[10px] mb-1">Send it to</div>
        {!mayReadSeller ? (
          <div className="text-text-muted">
            You do not have access to seller records, so the destination account is not shown. Ask
            someone who does for the payout details before sending.
          </div>
        ) : seller.isLoading ? (
          <div className="text-text-muted">Loading the seller&rsquo;s bank details…</div>
        ) : bankMissing ? (
          <div className="text-[var(--color-critical)]">
            This seller has no bank details on file. There is nowhere to send the money — ask them
            to add them on their profile before paying.
          </div>
        ) : s === undefined ? (
          <div className="text-text-muted">—</div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-text-faint">Bank</dt>
            <dd className="text-text-bright">{s.bankName}</dd>
            <dt className="text-text-faint">Branch</dt>
            {/* Bangladeshi routing is branch-scoped: the same bank and
                account number resolve differently per branch, so an
                instruction without it is incomplete. */}
            <dd className={s.bankBranchName === null ? 'text-[var(--color-warning)]' : ''}>
              {s.bankBranchName ?? 'not on file — routing is branch-scoped, ask for it'}
            </dd>
            <dt className="text-text-faint">Account name</dt>
            <dd className="text-text-bright">{s.bankAccountName}</dd>
            <dt className="text-text-faint">Account no.</dt>
            <dd className="font-mono text-text-bright">
              {revealed ?? s.bankAccountNumberMasked}
              {revealed === null && mayReveal && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2"
                  disabled={reveal.isPending}
                  onClick={() => {
                    reveal.mutate('Recording a remittance to this seller', {
                      onSuccess: (r) => setRevealed(r.accountNumber),
                    });
                  }}
                >
                  {reveal.isPending ? 'Revealing…' : 'Reveal'}
                </Button>
              )}
            </dd>
            {s.bankRoutingNumber !== null && (
              <>
                <dt className="text-text-faint">Routing</dt>
                <dd className="font-mono">{s.bankRoutingNumber}</dd>
              </>
            )}
            {s.bankSwiftCode !== null && (
              <>
                <dt className="text-text-faint">SWIFT</dt>
                <dd className="font-mono">{s.bankSwiftCode}</dd>
              </>
            )}
          </dl>
        )}
        {reveal.isError && <ErrorNote className="mt-1" message={serverVerdict(reveal.error)} />}
      </div>

      <div className="border-t border-border pt-2">
        <div className="text-text-faint uppercase tracking-wide text-[10px] mb-1">
          What we hold in {currency}
        </div>
        {!mayReadTreasury ? (
          <div className="text-text-muted">
            You do not have treasury access, so balances are not shown — check with someone who does
            before sending, or the transfer may bounce.
          </div>
        ) : treasury.isLoading ? (
          <div className="text-text-muted">Loading balances…</div>
        ) : accounts.length === 0 ? (
          <div className="text-[var(--color-critical)]">
            No {currency} account is set up, so this payout cannot leave from anywhere.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {accounts.map((a) => {
              const enough = !haveWanted || Number(a.total) >= wanted;
              return (
                <li key={a.accountId} className="flex items-baseline justify-between gap-3">
                  <span className={enough ? 'text-text-bright' : 'text-text-muted'}>
                    {a.label} · {a.bankName}
                  </span>
                  <span className={enough ? '' : 'text-[var(--color-warning)]'}>
                    <Money amount={a.total} currency={a.currency} convert={false} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {mayReadTreasury && shortfall && (
          <div className="mt-1.5 text-[var(--color-warning)]">
            No single {currency} account holds{' '}
            <Money amount={amount} currency={currency} convert={false} /> on its own. Move money
            between our accounts on Treasury first — a payout leaves ONE account, so the total
            across all of them is not the test.
          </div>
        )}
      </div>
    </div>
  );
}
