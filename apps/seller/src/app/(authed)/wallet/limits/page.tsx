'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Crumbs, PageHeader } from '@skydrop/ui/components';
import { WithdrawalScheduleCard } from '../_components/withdrawal-schedule-card';
import { WalletTermsCard } from '../_components/wallet-terms-card';

/**
 * The rules this wallet runs on, on their own page.
 *
 * They were the last card on /wallet, below the ledger — which is the
 * wrong place for them: a seller looks these up when a withdrawal is refused
 * or a charge surprises them, and at that moment they are scrolling past
 * the very history that raised the question. A page can also be linked
 * to, so a refusal can point at the rule that caused it.
 *
 * ── NO STAT TILES, DELIBERATELY ─────────────────────────────────────
 * Every figure on this page is a THRESHOLD, not a position — a cap, a
 * floor, a percentage. Lifting one into a tile would put a rule where
 * this console puts a balance, and the two read very differently at a
 * glance. The two bands below carry the numbers, each beside the
 * sentence that says what it does.
 */
export default function WalletLimitsPage(): ReactElement {
  return (
    <div>
      <Link
        href="/wallet"
        className="text-text-muted hover:text-text-bright mb-3 inline-flex items-center gap-1.5 text-xs"
      >
        <ArrowLeft size={13} aria-hidden />
        Back to wallet
      </Link>

      <PageHeader
        breadcrumb={
          <Crumbs
            items={[
              { label: 'Seller console' },
              { label: 'Money' },
              { label: 'Wallet', href: '/wallet' },
              { label: 'Limits' },
            ]}
            Link={Link}
          />
        }
        title="Wallet limits and settings"
        subtitle="Every rule that decides what you can take out, when COD reaches you, and what is charged. Set by Skydrop — ask us if one looks wrong for your account."
      />

      {/* What you can change, then what you cannot. Mixing the two was
          the old shape: a list of eighteen facts where two happened to
          be adjustable, which is not discoverable. Each band carries
          its own ordinal (01, 02) inside the component. */}
      <WithdrawalScheduleCard />
      <WalletTermsCard />
    </div>
  );
}
