'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The four faces of one subsystem.
 *
 * These belong together rather than as four sidebar entries: an operator
 * clearing the queue is the same person who wonders why a message was
 * labelled the way it was, and who checks what the portal did overnight.
 * Splitting them across the nav would put four items in front of everyone
 * for a job that one person does in one sitting.
 */
const TABS: readonly { readonly href: string; readonly label: string }[] = [
  { href: '/courier-escalation', label: 'Send queue' },
  { href: '/courier-escalation/threads', label: 'Conversations' },
  { href: '/courier-escalation/templates', label: 'Patterns' },
  { href: '/courier-escalation/portal', label: 'Portal worker' },
];

export function EscalationTabs(): ReactElement {
  const pathname = usePathname();
  return (
    <nav aria-label="Escalation views" className="border-border mb-4 flex gap-1 border-b">
      {TABS.map((t) => {
        // Exact match, not prefix: '/courier-escalation' is a prefix of
        // all three others and would light up on every tab.
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'border-accent text-text-body -mb-px border-b-2 px-3 py-2 text-sm font-medium'
                : 'text-text-muted hover:text-text-body -mb-px border-b-2 border-transparent px-3 py-2 text-sm'
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
