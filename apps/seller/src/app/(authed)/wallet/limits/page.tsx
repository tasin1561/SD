'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/components';
import { WalletTermsCard } from '../_components/wallet-terms-card';

/**
 * The rules this wallet runs on, on their own page.
 *
 * They were the last card on /wallet, below the ledger — which is the
 * wrong place for them: a seller looks these up when a payout is refused
 * or a charge surprises them, and at that moment they are scrolling past
 * the very history that raised the question. A page can also be linked
 * to, so a refusal can point at the rule that caused it.
 */
export default function WalletLimitsPage(): ReactElement {
  return (
    <div className="space-y-4">
      <Link
        href="/wallet"
        className="text-text-muted hover:text-text-bright inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft size={14} aria-hidden />
        Back to wallet
      </Link>

      <PageHeader
        title="Wallet limits and settings"
        subtitle="Every rule that decides what you can take out, when COD reaches you, and what is charged. Set by Skydrop — ask us if one looks wrong for your account."
      />

      <WalletTermsCard />
    </div>
  );
}
