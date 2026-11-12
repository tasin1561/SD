/**
 * The order header's More menu keeps EXACTLY the gating the old controls
 * had. Each item is HIDDEN, DISABLED (visible, `aria-disabled`, the reason
 * as a second line inside the item) or ENABLED, and which one is decided
 * by the condition the bottom Actions section / shipment buttons used:
 *
 *   Cancel            disabled when terminal | cancelling | no orders.cancel
 *   Force-mutate      disabled (reason) when no orders.override
 *   Release / Restore disabled (reason) when no orders.override
 *   Request return    HIDDEN unless DELIVERED and orders.cancel
 *   scan / cost / compute  HIDDEN when the control was not rendered
 *
 * "Disabled" is never a stand-in for "hidden", and the other way round.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MenuButton } from '@skydrop/ui/components';
import { tEn } from '@/i18n/catalog';
import {
  buildMoreEntries,
  type MoreMenuInput,
} from '@/app/(authed)/orders/_components/order-more-menu';

const noop = (): void => undefined;
function input(over: Partial<Omit<MoreMenuInput, 't' | 'open'>> = {}): MoreMenuInput {
  return {
    t: tEn,
    orderStatus: 'IN_TRANSIT',
    canOverride: true,
    canCancel: true,
    inTerminalState: false,
    cancelPending: false,
    canRequestReturn: false,
    canRecordScan: true,
    canRecordCost: true,
    canCompute: true,
    open: {
      cancel: noop,
      override: noop,
      release: noop,
      restore: noop,
      requestReturn: noop,
      recordScan: noop,
      recordCost: noop,
      compute: noop,
    },
    ...over,
  };
}

function ids(over: Partial<Omit<MoreMenuInput, 't' | 'open'>> = {}): string[] {
  return buildMoreEntries(input(over))
    .filter((e) => e.kind === 'action')
    .map((e) => e.id);
}

function action(
  over: Partial<Omit<MoreMenuInput, 't' | 'open'>>,
  id: string,
): { disabled?: boolean | undefined; hint?: string | undefined } | undefined {
  const e = buildMoreEntries(input(over)).find((x) => x.kind === 'action' && x.id === id);
  return e?.kind === 'action' ? e : undefined;
}

describe('More menu gating parity', () => {
  it('a full-permission admin sees every secondary item and the three god-mode items, all enabled', () => {
    const entries = buildMoreEntries(input());
    expect(ids()).toEqual(['scan', 'cost', 'compute', 'cancel', 'override', 'release', 'restore']);
    for (const e of entries) if (e.kind === 'action') expect(e.disabled).not.toBe(true);
  });

  it('god-mode items are DISABLED with a reason (not hidden) without orders.override', () => {
    expect(ids({ canOverride: false })).toEqual(
      expect.arrayContaining(['override', 'release', 'restore']),
    );
    expect(action({ canOverride: false }, 'override')).toMatchObject({
      disabled: true,
      hint: tEn('ordersOrderActionsPanel.requiresTheGodModeOverride'),
    });
    for (const id of ['release', 'restore']) {
      expect(action({ canOverride: false }, id)).toMatchObject({
        disabled: true,
        hint: tEn('ordersOrderActionsPanel.requiresSuperAdminRole'),
      });
    }
    // with the permission there is no reason line at all
    expect(action({ canOverride: true }, 'override')?.hint).toBeUndefined();
  });

  it('Cancel is disabled when terminal, pending or not permitted — with the matching reason', () => {
    expect(action({ inTerminalState: true, orderStatus: 'DELIVERED' }, 'cancel')).toMatchObject({
      disabled: true,
      hint: tEn('ordersOrderActionsPanel.alreadyInATerminalState', { value: 'delivered' }),
    });
    expect(action({ cancelPending: true }, 'cancel')?.disabled).toBe(true);
    expect(action({ canCancel: false }, 'cancel')?.disabled).toBe(true);
    expect(action({}, 'cancel')?.disabled).not.toBe(true);
  });

  it('Request return is HIDDEN unless the order is DELIVERED and orders.cancel is held', () => {
    expect(ids({ canRequestReturn: false })).not.toContain('return');
    expect(ids({ canRequestReturn: true })).toContain('return');
  });

  it('scan, cost and compute are HIDDEN (never disabled) when their control was not rendered', () => {
    const none = ids({ canRecordScan: false, canRecordCost: false, canCompute: false });
    expect(none).not.toContain('scan');
    expect(none).not.toContain('cost');
    expect(none).not.toContain('compute');
    expect(none).toContain('cancel');
  });

  it('renders the reason as a second line INSIDE a focusable, aria-disabled menu item that does nothing', async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    const entries = buildMoreEntries({
      ...input({ canOverride: false }),
      open: { ...input().open, override: onOverride },
    });
    render(<MenuButton label="More" entries={entries} />);
    await user.click(screen.getByRole('button', { name: 'More' }));

    const item = screen.getByRole('menuitem', { name: /Force-mutate/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    // the reason is part of the item (read out with its name), not a tooltip
    expect(
      within(item).getByText(tEn('ordersOrderActionsPanel.requiresTheGodModeOverride')),
    ).toBeInTheDocument();
    // still in the roving-focus order
    item.focus();
    expect(item).toHaveFocus();
    await user.click(item);
    expect(onOverride).not.toHaveBeenCalled();
    // the three are inside one labelled group
    expect(screen.getByRole('group', { name: tEn('orderDetail.danger.groupLabel') })).toBeTruthy();
  });

  it('an enabled item runs its action, closes the menu and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const entries = buildMoreEntries({
      ...input(),
      open: { ...input().open, cancel: onCancel },
    });
    render(<MenuButton label="More" entries={entries} />);
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: /Cancel order/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('the link-menu mode of MenuButton is unchanged (items + Link)', async () => {
    const user = userEvent.setup();
    const Link = (p: {
      href: string;
      className: string;
      role: 'menuitem';
      tabIndex: number;
      onClick: () => void;
      children: React.ReactNode;
    }): React.ReactElement => (
      <a
        href={p.href}
        className={p.className}
        role={p.role}
        tabIndex={p.tabIndex}
        onClick={p.onClick}
      >
        {p.children}
      </a>
    );
    render(<MenuButton label="Go" Link={Link} items={[{ href: '/x', label: 'Ex' }]} />);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('menuitem', { name: 'Ex' })).toHaveAttribute('href', '/x');
  });
});
