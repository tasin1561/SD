'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Button, EmptyState, PageHeader } from '@skydrop/ui/components';
import { canAccess, homeFor, type SellerRole } from '@/lib/role-access';

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
  role,
  children,
}: {
  readonly role: SellerRole;
  readonly children: ReactNode;
}): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  const allowed = canAccess(role, pathname);
  const home = homeFor(role);
  const isLanding = pathname === '/dashboard';

  useEffect(() => {
    if (!allowed && isLanding) router.replace(home);
  }, [allowed, isLanding, home, router]);

  if (allowed) return <>{children}</>;

  // Mid-redirect on the landing route — render nothing rather than a
  // refusal that flashes for one frame and is gone.
  if (isLanding) return <></>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Not available" />
      <EmptyState
        title="This section is not part of your access"
        description={`Your account has the ${role.toLowerCase()} role, which covers orders and tracking. Ask an owner or admin on your team if you need more.`}
        action={
          <Button variant="primary" size="md" onClick={() => router.push(home)}>
            Go to orders
          </Button>
        }
      />
    </div>
  );
}
