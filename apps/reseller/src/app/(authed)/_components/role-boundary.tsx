'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '@skydrop/ui/app/button';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import '../settings/_components/rd.css';
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
    <div className="rd-page" data-width="narrow">
      <PageHeader title="Not available" />
      <EmptyState
        title="This section is not part of your access"
        description={`This page needs the “${needed ?? 'unknown'}” permission and your role does not have it. An owner of your store can change your role under Team.`}
        action={
          <Button
            variant="primary"
            size="md"
            icon={<LayoutDashboard size={15} />}
            onClick={() => router.push(FALLBACK_PATH)}
          >
            Go to the dashboard
          </Button>
        }
      />
    </div>
  );
}
