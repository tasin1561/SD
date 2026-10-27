'use client';

import { useRouter, usePathname } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { Button, EmptyState, PageHeader } from '@skydrop/ui/components';
import { useT } from '@/i18n/client';
import { canSeePath, permissionForPath, FALLBACK_PATH } from '@/lib/page-access';

/**
 * Hides pages this person has no permission for.
 *
 * COSMETIC (FE-2). The API's permission guard refuses the underlying
 * requests whatever this renders. What this buys is the difference
 * between "this is not part of your access" and a page that loads, fills
 * with spinners, and resolves into a wall of 403s.
 *
 * It wraps the whole `(authed)` tree rather than being added page by
 * page — thirty pages is thirty chances to forget one, and the forgotten
 * one is exactly the page that looks broken.
 *
 * A refusal EXPLAINS rather than redirects. A silent bounce from a URL
 * somebody typed or bookmarked reads as a broken link, and the useful
 * information — which permission is missing, so they know what to ask
 * for — is exactly what a redirect throws away.
 */
export function PermissionBoundary({
  permissions,
  children,
}: {
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();

  if (canSeePath({ permissions }, pathname)) return <>{children}</>;

  const needed = permissionForPath(pathname);

  return (
    // A refusal is prose, so it keeps a reading width — unlike a
    // page, which fills the space it is given.
    <div className="max-w-2xl">
      <PageHeader title={t('boundary.title')} />
      <EmptyState
        title={t('boundary.empty')}
        description={
          needed === null ? t('boundary.noRole') : t('boundary.needs', { permission: needed })
        }
        action={
          <Button variant="primary" size="md" onClick={() => router.push(FALLBACK_PATH)}>
            {t('boundary.goDashboard')}
          </Button>
        }
      />
    </div>
  );
}
