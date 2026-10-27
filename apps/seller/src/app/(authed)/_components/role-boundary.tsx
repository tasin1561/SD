'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { canSeePath, permissionForPath, FALLBACK_PATH } from '@/lib/page-access';
import { useT } from '@/i18n/client';

/**
 * Hides pages a role has no business on.
 *
 * COSMETIC (FE-2). The server refuses the underlying requests whatever
 * this renders — see `SellerJwtGuard`. What this buys is the difference
 * between "this page is not for you" and a page that loads, lets you
 * fill in a form, and only then refuses to save it.
 *
 * It wraps the whole `(authed)` tree rather than being added page by
 * page: 24 pages is 24 chances to forget one, and a forgotten page is
 * exactly the one that looks broken.
 *
 * The landing route is special-cased. `/` redirects to `/dashboard`,
 * which a VIEWER cannot see — greeting them with a refusal on sign-in
 * would be a poor first impression, so they are sent to their own home
 * instead. Any OTHER disallowed route explains itself rather than
 * bouncing, because a silent redirect from a URL someone typed or
 * bookmarked is confusing.
 */
export function RoleBoundary({
  permissions,
  children,
}: {
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = canSeePath({ permissions }, pathname);
  const home = FALLBACK_PATH;
  const needed = permissionForPath(pathname);
  const isLanding = pathname === FALLBACK_PATH;

  useEffect(() => {
    if (!allowed && isLanding) router.replace(home);
  }, [allowed, isLanding, home, router]);

  if (allowed) return <>{children}</>;

  // Mid-redirect on the landing route — render nothing rather than a
  // refusal that flashes for one frame and is gone.
  if (isLanding) return <></>;

  return (
    // A refusal is prose, so it keeps a reading width — unlike a
    // page, which fills the space it is given.
    <div className="max-w-2xl">
      <PageHeader title={t('authedShell.notAvailable')} />
      <EmptyState
        title={t('authedShell.thisSectionIsNot')}
        description={
          needed === null
            ? t('authedShell.yourRoleDoesNot')
            : t('authedShell.thisPageNeedsThe', { needed })
        }
        action={
          <Button variant="primary" size="md" onClick={() => router.push(home)}>
            {t('authedShell.goToTheDashboard')}
          </Button>
        }
      />
    </div>
  );
}
