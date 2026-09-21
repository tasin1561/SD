import type { ReactElement } from 'react';
import { SiteHeader } from '@/components/chrome/site-header';
import { UtilityBar } from '@/components/chrome/utility-bar';

/**
 * The page's top chrome: utility bar over the header. Kept under the old
 * `Nav` export so the three pages that mount it need no change; the real
 * components live in `components/chrome/`.
 */
export function Nav(): ReactElement {
  return (
    <>
      <UtilityBar />
      <SiteHeader />
    </>
  );
}
