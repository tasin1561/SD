'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { FileWarning, ScrollText } from 'lucide-react';
import { useStoreTerms } from '@/lib/terms-hooks';
import { RdCallout } from '../settings/_components/rd-parts';

/**
 * RS-4 — the portal-wide notice while the terms in force are unaccepted.
 *
 * ── IT STAYS, NOW THAT THERE IS AN INBOX (2026-09-19) ────────────────
 * This used to say it WAS the store's in-app notification for new terms,
 * because store users had no inbox. They have one, and `store.terms_published`
 * now lands in it — so the honest question is whether this banner is
 * redundant. It is not, and the distinction is worth stating: an inbox
 * line is an EVENT ("this happened"), and it is dismissible on purpose;
 * this banner is a CONDITION ("you cannot place orders"), and its entire
 * value is that it cannot be dismissed, only answered. Dismissing the
 * notification must not make the block invisible, and a block that
 * clears itself when somebody clicks it away would be the worst of both.
 *
 * So: both, for the same fact, each doing what the other cannot. The
 * banner also covers the case the notification cannot — a person who
 * joined the store AFTER the version was published has no inbox line for
 * it, and still cannot order until somebody accepts.
 *
 * Rendered only for people who may read the terms (`enabled`, from the
 * shell's permission check), so it never fires a request that would 403.
 */
export function TermsBanner({ enabled }: { enabled: boolean }): ReactElement | null {
  const terms = useStoreTerms(enabled);
  const t = terms.data;
  if (!enabled || t === undefined) return null;
  if (t.current === null) {
    return (
      <RdCallout tone="info" icon={<ScrollText size={15} />} role="status" className="rd-banner">
        <p>
          {t.sellerCompanyName} has not published terms for your store yet. You can place orders
          once they have and you have accepted them.
        </p>
      </RdCallout>
    );
  }
  if (t.currentAccepted && t.needsRevision === null) return null;
  return (
    <RdCallout tone="critical" icon={<FileWarning size={15} />} role="alert" className="rd-banner">
      <p>
        {t.needsRevision ??
          `${t.sellerCompanyName} published version ${t.current.version} of your terms. Your store cannot place new orders until it is accepted.`}{' '}
        <Link href="/terms" className="rd-link">
          Read the terms
        </Link>
      </p>
    </RdCallout>
  );
}
