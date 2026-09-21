import { Copy, Mail, MessageCircle, Phone } from 'lucide-react';
import type { FanItem } from '@/components/micro/contact-fan';
import { business, platform } from '@/content/site';

/** The four contact channels — ONE list for the floating fan and the mobile bar. */
export function contactItems(): FanItem[] {
  return [
    {
      id: 'whatsapp',
      icon: <MessageCircle size={15} aria-hidden="true" />,
      hue: 'green',
      label: 'WhatsApp',
      href: business.whatsappHref,
      external: true,
    },
    {
      id: 'call',
      icon: <Phone size={15} aria-hidden="true" />,
      hue: 'blue',
      label: 'Call',
      detail: business.hotline,
      href: business.hotlineHref,
    },
    {
      id: 'email',
      icon: <Mail size={15} aria-hidden="true" />,
      hue: 'violet',
      label: 'Email',
      detail: platform.brand.email,
      href: `mailto:${platform.brand.email}`,
    },
    {
      id: 'copy',
      icon: <Copy size={15} aria-hidden="true" />,
      hue: 'saffron',
      label: 'Copy hotline number',
      busyLabel: 'Copying…',
      doneLabel: 'Number copied',
      failLabel: 'Could not copy — long-press the number',
      action: () => navigator.clipboard.writeText(business.hotline),
    },
  ];
}
