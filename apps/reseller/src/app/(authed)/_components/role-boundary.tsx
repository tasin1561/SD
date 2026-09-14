'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { Button, EmptyState, PageHeader } from '@skydrop/ui/components';
import { canSeePath, FALLBACK_PATH, permissionForPath } from '@/lib/page-access';

/**
 * Hides pages a store role has no business on. COSMETIC (FE-2): the
 * store guard refuses the requests whatever this renders. It explains
 * rather than bouncing, because a silent redirect from a URL somebody
 * typed or bookmarked is confusing.
 */
export function RoleBoundary({
  permissions,
  children,
}: {
  readonly permissions: readonly string[];
  readonly children: ReactNode;
}): ReactElement {
  const pathname = usePathname();
  const router = useRouter();
  if (canSeePath({ permissions }, pathname)) return <>{children}</>;
  const needed = permissionForPath(pathname);
  return (
    <div className="max-w-2xl">
      <PageHeader title="Not available" />
      <EmptyState
        title="This section is not part of your access"
        description={`This page needs the “${needed ?? 'unknown'}” permission and your role does not have it. An owner of your store can change your role under Team.`}
        action={
          <Button variant="primary" size="md" onClick={() => router.push(FALLBACK_PATH)}>
            Go to the dashboard
          </Button>
        }
      />
    </div>
  );
}
