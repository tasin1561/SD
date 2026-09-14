'use client';

import Link from 'next/link';
import type { ReactElement } from 'react';
import { useStoreTerms } from '@/lib/terms-hooks';

/**
 * RS-4 — the portal-wide notice while the terms in force are unaccepted.
 *
 * This IS the store's in-app notification for new terms: store users have
 * no inbox in phase 1, and a banner that stays until the version is
 * accepted is stronger than a notice somebody can dismiss. Rendered only
 * for people who may read the terms (`enabled`, from the shell's
 * permission check), so it never fires a request that would 403.
 */
export function TermsBanner({ enabled }: { enabled: boolean }): ReactElement | null {
  const terms = useStoreTerms(enabled);
  const t = terms.data;
  if (!enabled || t === undefined) return null;
  if (t.current === null) {
    return (
      <p
        role="status"
        className="border-border bg-surface-raised text-text-body mb-4 rounded-lg border px-3 py-2 text-sm"
      >
        {t.sellerCompanyName} has not published terms for your store yet. You can place orders once
        they have and you have accepted them.
      </p>
    );
  }
  if (t.currentAccepted && t.needsRevision === null) return null;
  return (
    <p
      role="alert"
      className="border-border bg-surface-raised text-critical mb-4 rounded-lg border px-3 py-2 text-sm"
    >
      {t.needsRevision ??
        `${t.sellerCompanyName} published version ${t.current.version} of your terms. Your store cannot place new orders until it is accepted.`}{' '}
      <Link href="/terms" className="text-accent hover:text-accent-hover underline">
        Read the terms
      </Link>
    </p>
  );
}
