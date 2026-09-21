'use client';

import type { ReactElement } from 'react';
import { ContactFan } from '@/components/micro/contact-fan';
import { contactItems } from './contact-items';

/**
 * The floating contact control — bottom-right, DESKTOP ONLY (`md:` up).
 * Below that the mobile bottom bar's "Contact" item opens the same fan, so
 * the button no longer sits on top of page content on a phone.
 */
export function FloatingContact(): ReactElement {
  return (
    <div className="fixed bottom-6 right-6 z-40 hidden md:block">
      <ContactFan items={contactItems()} />
    </div>
  );
}
