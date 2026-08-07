import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuButton, type MenuAction } from '@skydrop/ui/components';
import { quickActionsFor } from '@/lib/quick-actions';
import { canSeePath } from '@/lib/page-access';

/**
 * The Quick actions menu in the top bar.
 *
 * Two things are worth pinning. The keyboard contract, because a menu
 * that only works with a mouse looks completely fine in a screenshot —
 * every failure here is invisible until someone tries to use it. And
 * the permission gating, because the action the menu offers and the
 * permission the server enforces are two different strings that have
 * to agree.
 */

// A stand-in for next/link — same required-prop shape as MenuLinkLike.
function TestLink({
  href,
  className,
  role,
  tabIndex,
  onClick,
  children,
}: {
  href: string;
  className: string;
  role: 'menuitem';
  tabIndex: number;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <a href={href} className={className} role={role} tabIndex={tabIndex} onClick={onClick}>
      {children}
    </a>
  );
}

const TWO: MenuAction[] = [
  { href: '/orders/new', label: 'New order' },
  { href: '/orders/import', label: 'Import CSV' },
];

function open(): HTMLElement {
  const trigger = screen.getByRole('button', { name: /quick actions/i });
  fireEvent.click(trigger);
  return trigger;
}

describe('MenuButton — the keyboard contract', () => {
  it('announces itself as a menu button and reflects open state', () => {
    render(<MenuButton label="Quick actions" items={TWO} Link={TestLink} />);
    const trigger = screen.getByRole('button', { name: /quick actions/i });

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('puts focus on the first item when opened, not on the panel', () => {
    render(<MenuButton label="Quick actions" items={TWO} Link={TestLink} />);
    open();
    expect(document.activeElement?.textContent).toContain('New order');
  });

  it('arrow keys move focus and wrap in both directions', () => {
    render(<MenuButton label="Quick actions" items={TWO} Link={TestLink} />);
    open();
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('Import CSV');

    // Past the end, back to the top.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toContain('New order');

    // Before the start, round to the bottom.
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toContain('Import CSV');
  });

  it('Escape closes AND returns focus to the trigger', () => {
    // The second half is the one that matters: without it focus falls to
    // <body> and a keyboard user restarts from the top of the page.
    render(<MenuButton label="Quick actions" items={TWO} Link={TestLink} />);
    const trigger = open();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('only one item is in the tab order (roving tabindex)', () => {
    render(<MenuButton label="Quick actions" items={TWO} Link={TestLink} />);
    open();
    const tabbable = screen.getAllByRole('menuitem').filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });

  it('renders nothing at all when the caller has no actions to offer', () => {
    // Not an empty button that opens onto a blank panel.
    const { container } = render(<MenuButton label="Quick actions" items={[]} Link={TestLink} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('quickActionsFor — gated on what the server enforces', () => {
  it('offers New order to someone who may create orders', () => {
    const actions = quickActionsFor({ permissions: ['orders.view', 'orders.create'] });
    expect(actions.map((a) => a.href)).toEqual(['/orders/new']);
  });

  it('offers nothing to a read-only seller who can see orders but not create them', () => {
    // orders.view alone must NOT surface it — that is the exact pair the
    // /orders prefix would have conflated.
    expect(quickActionsFor({ permissions: ['orders.view'] })).toHaveLength(0);
  });

  it('offers nothing when there is no identity', () => {
    expect(quickActionsFor(null)).toHaveLength(0);
  });
});

describe('the create form itself is gated the same way', () => {
  const viewer = { permissions: ['orders.view'] };
  const creator = { permissions: ['orders.view', 'orders.create'] };

  it('/orders/new needs orders.create, not just orders.view', () => {
    expect(canSeePath(viewer, '/orders/new')).toBe(false);
    expect(canSeePath(creator, '/orders/new')).toBe(true);
  });

  it('but the orders list stays open to a read-only role', () => {
    expect(canSeePath(viewer, '/orders')).toBe(true);
    expect(canSeePath(viewer, '/orders/abc-123')).toBe(true);
  });
});
