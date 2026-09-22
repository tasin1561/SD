'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { LiquidBead } from '@/components/micro/liquid-bead';

/**
 * The FAQ's category tabs, and NOTHING else.
 *
 * The questions themselves are server-rendered and passed in as
 * `children`: every answer stays in the HTML whichever tab is chosen, so
 * the FAQPage structured data describes a page that really carries all of
 * them, and a reader with no JavaScript gets the whole list. This island's
 * entire job is to put one attribute on the wrapper; CSS does the hiding.
 */
export function FaqTabsClient({
  tabs,
  label,
  children,
}: {
  tabs: readonly { id: string; label: string; hue: string }[];
  label: string;
  children: ReactNode;
}): ReactElement {
  const [category, setCategory] = useState('all');
  return (
    <div className="faq" data-category={category}>
      <div className="faq__tabs">
        <LiquidBead tabs={tabs} value={category} onChange={setCategory} label={label} />
      </div>
      {children}
    </div>
  );
}
