'use client';

import { useState, type ReactElement } from 'react';
import { Money } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { MkAlert } from '../../seller-wallets/_components/money-parts';
import { serverVerdict } from '@/lib/server-verdict';
import { useRevealSellerBankAccount, useSellerDetail } from '@/lib/api-hooks';
import { usePermission } from '@/lib/use-permission';
import { useSellerHoldings, useTreasuryOverview } from '@/lib/ops-hooks';

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
  // Where THIS seller's money is sitting, per account. Not the same
  // question as what an account holds in total: most of that balance is
  // ours or somebody else's, and paying out of an account that is full
  // of another seller's cash is how the client-money total stops
  // matching what we actually owe (TRE-1/TRE-8).
  const holdings = useSellerHoldings(mayReadTreasury ? sellerId : null);
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
    <div className="mk-panel">
      <div className="mk-panel__part">
        <p className="mk-panel__title">Send it to</p>
        {!mayReadSeller ? (
          <p className="mk-muted">
            You do not have access to seller records, so the destination account is not shown. Ask
            someone who does for the payout details before sending.
          </p>
        ) : seller.isLoading ? (
          <Skeleton height={40} width="100%" />
        ) : bankMissing ? (
          <p className="mk-text" data-tone="critical">
            This seller has no bank details on file. There is nowhere to send the money — ask them
            to add them on their profile before paying.
          </p>
        ) : s === undefined ? (
          <div className="mk-muted">—</div>
        ) : (
          <dl className="mk-kv">
            <dt>Bank</dt>
            <dd>{s.bankName}</dd>
            <dt>Branch</dt>
            {/* Bangladeshi routing is branch-scoped: the same bank and
                account number resolve differently per branch, so an
                instruction without it is incomplete. */}
            <dd className="mk-text" data-tone={s.bankBranchName === null ? 'warn' : undefined}>
              {s.bankBranchName ?? 'not on file — routing is branch-scoped, ask for it'}
            </dd>
            <dt>Account name</dt>
            <dd>{s.bankAccountName}</dd>
            <dt>Account no.</dt>
            <dd>
              <span className="sk-ident">{revealed ?? s.bankAccountNumberMasked}</span>
              {revealed === null && mayReveal && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={reveal.isPending}
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
                <dt>Routing</dt>
                <dd className="sk-ident">{s.bankRoutingNumber}</dd>
              </>
            )}
            {s.bankSwiftCode !== null && (
              <>
                <dt>SWIFT</dt>
                <dd className="sk-ident">{s.bankSwiftCode}</dd>
              </>
            )}
          </dl>
        )}
        {reveal.isError && <MkAlert>{serverVerdict(reveal.error)}</MkAlert>}
      </div>

      {mayReadTreasury && (
        <div className="mk-panel__part">
          <p className="mk-panel__title">Of that, this seller&rsquo;s</p>
          {holdings.isLoading ? (
            <Skeleton height={16} width="66%" />
          ) : (holdings.data ?? []).length === 0 ? (
            <p className="mk-muted">
              None of our accounts holds cash attributed to this seller. That is normal for a wallet
              built from credits rather than transfers — the money to pay them is our capital, and
              paying it is what settles the liability.
            </p>
          ) : (
            <ul className="mk-list">
              {(holdings.data ?? []).map((h) => (
                <li key={h.accountId} className="mk-list__row">
                  <span className="mk-strong">{h.label}</span>
                  <span>
                    <Money amount={h.amount} currency={h.currency} convert={false} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mk-panel__part">
        <p className="mk-panel__title">What we hold in {currency}</p>
        {!mayReadTreasury ? (
          <p className="mk-muted">
            You do not have treasury access, so balances are not shown — check with someone who does
            before sending, or the transfer may bounce.
          </p>
        ) : treasury.isLoading ? (
          <Skeleton height={32} width="100%" />
        ) : accounts.length === 0 ? (
          <p className="mk-text" data-tone="critical">
            No {currency} account is set up, so this payout cannot leave from anywhere.
          </p>
        ) : (
          <ul className="mk-list">
            {accounts.map((a) => {
              const enough = !haveWanted || Number(a.total) >= wanted;
              return (
                <li key={a.accountId} className="mk-list__row">
                  <span className={enough ? 'mk-strong' : 'mk-small'}>
                    {a.label} · {a.bankName}
                  </span>
                  <span className="mk-text" data-tone={enough ? undefined : 'warn'}>
                    <Money amount={a.total} currency={a.currency} convert={false} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {mayReadTreasury && shortfall && (
          <p className="mk-text mk-small" data-tone="warn">
            No single {currency} account holds{' '}
            <Money amount={amount} currency={currency} convert={false} /> on its own. Move money
            between our accounts on Treasury first — a payout leaves ONE account, so the total
            across all of them is not the test.
          </p>
        )}
      </div>
    </div>
  );
}
