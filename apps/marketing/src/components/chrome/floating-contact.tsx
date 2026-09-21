'use client';

import type { ReactElement } from 'react';
import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import { RadialContactFan } from '@/components/micro/radial-contact-fan';
import { business, platform } from '@/content/site';

/**
 * The floating contact control — bottom-right, above the mobile bar — is
 * micro pattern 9, the radial fan: WhatsApp · Call · Email · Copy hotline.
 * Links navigate at once; "Copy" is the one honest success state, because
 * the clipboard write is real and local.
 */
export function FloatingContact(): ReactElement {
  return (
    <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-40 md:bottom-6 md:right-6">
      <RadialContactFan
        items={[
          {
            id: 'whatsapp',
            icon: <MessageCircle size={18} aria-hidden="true" />,
            label: 'WhatsApp',
            href: business.whatsappHref,
            external: true,
          },
          {
            id: 'call',
            icon: <Phone size={18} aria-hidden="true" />,
            label: `Call ${business.hotline}`,
            href: business.hotlineHref,
          },
          {
            id: 'email',
            icon: <Mail size={18} aria-hidden="true" />,
            label: platform.brand.email,
            href: `mailto:${platform.brand.email}`,
          },
          {
            id: 'copy',
            icon: <Copy size={18} aria-hidden="true" />,
            label: 'Copy hotline number',
            doneLabel: 'Number copied',
            failLabel: 'Could not copy — long-press the number',
            action: () => navigator.clipboard.writeText(business.hotline),
          },
        ]}
      />
    </div>
  );
}
