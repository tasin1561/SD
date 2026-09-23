'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tabs } from '@skydrop/ui/app/tabs';

/**
 * The four faces of one subsystem.
 *
 * These belong together rather than as four sidebar entries: an operator
 * clearing the queue is the same person who wonders why a message was
 * labelled the way it was, and who checks what the portal did overnight.
 * Splitting them across the nav would put four items in front of everyone
 * for a job that one person does in one sitting.
 *
 * Route tabs: every item carries an `href`, so the primitive renders a
 * `nav` of links with `aria-current="page"` and the liquid bead slides to
 * the current one. They stay navigation — the same four hrefs.
 */
const TABS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/courier-escalation', label: 'Send queue' },
  { href: '/courier-escalation/threads', label: 'Conversations' },
  { href: '/courier-escalation/templates', label: 'Patterns' },
  { href: '/courier-escalation/portal', label: 'Portal worker' },
];

export function EscalationTabs(): ReactElement {
  const pathname = usePathname();
  // Exact match, not prefix: '/courier-escalation' is a prefix of all
  // three others and would light up on every tab.
  const active = TABS.find((t) => pathname === t.href)?.href ?? '';
  return (
    <Tabs
      label="Escalation views"
      Link={Link}
      value={active}
      items={TABS.map((t) => ({ id: t.href, label: t.label, href: t.href }))}
    />
  );
}
