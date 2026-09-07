/**
 * The bell panel.
 *
 * The properties worth pinning are the ones a redesign could quietly
 * lose: that a tab can never be empty, that filtering actually filters,
 * and that dismissing is wired to the callback rather than to a local
 * "hide it" that would reappear on the next fetch.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell, type BellItem } from '@skydrop/ui/components';
import type { ReactElement, ReactNode } from 'react';

function TestLink({
  href,
  className,
  children,
  onClick,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}): ReactElement {
  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

const GROUPS: Record<string, string> = {
  'shipment.delivery_failed.seller': 'Couriers',
  'wallet.topup_accepted.seller': 'Money',
};

function items(): BellItem[] {
  return [
    {
      id: 'n1',
      title: 'Delivery attempt failed',
      body: 'The courier could not deliver SD-TEST-1.',
      topic: 'shipment.delivery_failed.seller',
      createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      readAt: null,
    },
    {
      id: 'n2',
      title: 'Top-up accepted',
      body: '₹5,000 is in your wallet.',
      topic: 'wallet.topup_accepted.seller',
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      readAt: new Date().toISOString(),
    },
  ];
}

async function openPanel(props: Partial<Parameters<typeof NotificationBell>[0]> = {}) {
  const user = userEvent.setup();
  render(
    <NotificationBell
      unread={1}
      items={items()}
      viewAllHref="/notifications"
      groupOf={(t) => GROUPS[t] ?? null}
      Link={TestLink}
      {...props}
    />,
  );
  await user.click(screen.getByRole('button', { name: /notifications/i }));
  return user;
}

describe('notification bell panel', () => {
  it('shows the unread count as a figure, not only a dot', async () => {
    await openPanel({ unread: 5 });
    expect(screen.getByText(/5 unread/i)).toBeInTheDocument();
  });

  it('says how long ago in words a person would use', async () => {
    await openPanel();
    expect(screen.getByText('12m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('tabs are the groups PRESENT, so a tab can never be empty', async () => {
    await openPanel();
    expect(screen.getByRole('tab', { name: /couriers/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /money/i })).toBeInTheDocument();
    // Nothing in the feed is a Return, so there is no Returns tab.
    expect(screen.queryByRole('tab', { name: /returns/i })).not.toBeInTheDocument();
  });

  it('choosing a tab filters the list', async () => {
    const user = await openPanel();
    expect(screen.getByText('Top-up accepted')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /couriers/i }));
    expect(screen.getByText('Delivery attempt failed')).toBeInTheDocument();
    expect(screen.queryByText('Top-up accepted')).not.toBeInTheDocument();
  });

  it('no grouping means no tab strip at all', async () => {
    const user = userEvent.setup();
    render(
      <NotificationBell unread={1} items={items()} viewAllHref="/notifications" Link={TestLink} />,
    );
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('dismiss calls back rather than hiding the row locally', async () => {
    // NOTIF-21: a dismiss is a WRITE that hides the row from this
    // person's feed for good. A component that only stopped rendering it
    // would show it again on the next poll.
    const onDismiss = vi.fn();
    const user = await openPanel({ onDismiss });
    await user.click(screen.getAllByRole('button', { name: /dismiss/i })[0]!);
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('no dismiss handler means no ✕ on the row', async () => {
    await openPanel();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('a row links to the full item, because the panel truncates', async () => {
    await openPanel();
    const link = screen.getByText('Delivery attempt failed').closest('a');
    expect(link).toHaveAttribute('href', '/notifications#n1');
  });
});
