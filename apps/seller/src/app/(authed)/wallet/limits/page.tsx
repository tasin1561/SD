'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { WithdrawalScheduleCard } from '../_components/withdrawal-schedule-card';
import { WalletTermsCard } from '../_components/wallet-terms-card';
import '../_components/wallet.css';
import { useT } from '@/i18n/client';

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
  const t = useT();
  return (
    <div className="wal-page">
      <Link href="/wallet" className="wal-back">
        <ArrowLeft size={14} aria-hidden />
        {t('wallet.backToWallet')}
      </Link>

      <PageHeader
        breadcrumbs={[
          { label: t('wallet.clientConsole') },
          { label: t('wallet.money') },
          { label: t('wallet.wallet'), href: '/wallet' },
          { label: t('wallet.limits') },
        ]}
        Link={Link}
        title={t('wallet.walletLimitsAndSettings')}
        subtitle={t('wallet.everyRuleThatDecides')}
      />

      {/* What you can change, then what you cannot. Mixing the two was
          the old shape: a list of eighteen facts where two happened to
          be adjustable, which is not discoverable. */}
      <WithdrawalScheduleCard />
      <WalletTermsCard />
    </div>
  );
}
