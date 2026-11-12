'use client';

import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button } from './button';

/**
 * A button that opens a small menu of navigation actions.
 *
 * WHY THIS IS HAND-ROLLED. The obvious answer is
 * `@radix-ui/react-dropdown-menu`, and if a second consumer needs
 * submenus, checkboxes or typeahead that is the right move. It is not
 * installed, and adding a dependency for one menu of one item is a
 * poor trade — so this implements the WAI-ARIA menu-button pattern
 * directly. The parts that actually matter are the ones a hand-rolled
 * menu usually gets wrong, so they are all here: roving focus so Tab
 * lands on the menu once rather than on every item, Escape returning
 * focus to the trigger (otherwise focus is lost to `<body>` and a
 * keyboard user restarts from the top of the page), arrow-key wrapping,
 * Home/End, and dismissal on outside pointerdown.
 *
 * Focus moves by querying the rendered items rather than by holding a
 * ref per item: `LinkLike` deliberately does not accept a ref (see
 * app-shell.tsx), and widening it to forward one would complicate every
 * caller for this single use.
 */

/**
 * ── ACTION MENUS (added for the admin order detail) ──────────────────
 * The link menu below is unchanged. `entries` is a second, opt-in way to
 * fill the same menu: buttons that RUN something rather than navigate,
 * group labels, separators, danger styling and items that are disabled
 * WITH A REASON. A disabled item keeps `role="menuitem"` and stays in the
 * roving-focus order with `aria-disabled="true"` — it is not skipped —
 * and its reason is a second muted line INSIDE the item, so a screen
 * reader reads it with the name instead of leaving it to a tooltip.
 */
export type MenuEntry =
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly label: string;
      /** Muted second line. For a disabled item this is the REASON. */
      readonly hint?: string;
      readonly icon?: ReactNode;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }
  | { readonly kind: 'separator'; readonly id: string }
  | {
      readonly kind: 'label';
      readonly id: string;
      readonly label: string;
      /** Muted line under the group label. */
      readonly description?: string;
    };

export type MenuAction = {
  readonly href: string;
  readonly label: string;
  /** One short line under the label. Optional — most actions read fine alone. */
  readonly hint?: string;
  readonly icon?: ReactNode;
};

/**
 * Same discipline as `LinkLike`: every prop REQUIRED, because
 * `exactOptionalPropertyTypes` will not unify an optional handler with
 * `next/link`'s signature. `role` and `tabIndex` are here rather than in
 * `LinkLike` because they are what make the roving-focus pattern work.
 */
export type MenuLinkLike = ComponentType<{
  href: string;
  className: string;
  role: 'menuitem';
  tabIndex: number;
  onClick: () => void;
  children: ReactNode;
}>;

export function MenuButton({
  label,
  items = [],
  Link,
  entries,
  triggerIcon,
  triggerAriaLabel,
  triggerClassName,
  /** In the mobile drawer the trigger sits at the bottom of the screen,
   *  so a menu opening downward would be off-screen. */
  placement = 'below',
  className,
}: {
  readonly label: string;
  readonly items?: readonly MenuAction[];
  readonly Link?: MenuLinkLike;
  /** Action-menu mode; takes precedence over `items`. */
  readonly entries?: readonly MenuEntry[];
  /** Replaces the chevron (e.g. a "⋯" for an icon-only trigger). */
  readonly triggerIcon?: ReactNode;
  /** Stable accessible name when the visible label is an icon or hidden. */
  readonly triggerAriaLabel?: string;
  readonly triggerClassName?: string;
  readonly placement?: 'below' | 'above';
  readonly className?: string;
}): ReactElement | null {
  const actionMode = entries !== undefined;
  const actionEntries = (entries ?? []).filter(
    (e): e is Extract<MenuEntry, { kind: 'action' }> => e.kind === 'action',
  );
  // How many focusable items the menu has, in either mode.
  const count = actionMode ? actionEntries.length : items.length;
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((refocusTrigger: boolean): void => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  }, []);

  // Move real DOM focus to the active item whenever it changes.
  useEffect(() => {
    if (!open) return;
    const nodes = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    nodes?.item(focusIndex)?.focus();
  }, [open, focusIndex]);

  // Dismiss on a click anywhere else. `pointerdown` rather than `click`
  // so the menu is gone before the underlying control reacts.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function openAt(index: number): void {
    setFocusIndex(index);
    setOpen(true);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      // preventDefault also stops the synthetic click, so this cannot
      // open and immediately re-close.
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(count - 1);
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setFocusIndex((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusIndex((i) => (i - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusIndex(count - 1);
        break;
      case 'Tab':
        // Let focus leave naturally; just don't leave a menu hanging open.
        setOpen(false);
        break;
      default:
        break;
    }
  }

  // Hooks must run unconditionally, so this guard sits below them. An
  // empty menu renders nothing rather than a button that opens onto a
  // blank panel — the caller filters by permission and may be left with
  // no actions at all.
  if (count === 0) return null;

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <Button
        ref={triggerRef}
        // `sm`, so the smaller type comes from the size token rather than
        // a `text-xs` bolted on top: two bare font-size utilities are
        // resolved by Tailwind's generated source order, and `text-sm`
        // wins that, so the override would have done nothing.
        size="sm"
        aria-haspopup="menu"
        aria-label={triggerAriaLabel}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) setOpen(false);
          else openAt(0);
        }}
        onKeyDown={onTriggerKeyDown}
        // Two words that must stay on one line: the header gives this a
        // share of a fixed strip, and left to wrap it became the tallest
        // thing in the bar.
        className={clsx(
          actionMode
            ? 'justify-center whitespace-nowrap'
            : 'w-full justify-center whitespace-nowrap lg:w-auto',
          triggerClassName,
        )}
      >
        {/* Wrapped so a caller can hide the WORD visually (e.g. on a
            phone header with no room) while it stays the button's
            accessible name — a bare text node cannot be targeted. */}
        {triggerIcon !== undefined ? null : <span className="sk-menu-button__label">{label}</span>}
        {triggerIcon !== undefined ? (
          <span aria-hidden="true">{triggerIcon}</span>
        ) : (
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={clsx('transition-transform', open && 'rotate-180')}
          />
        )}
      </Button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={clsx(
            'border-border bg-surface-raised absolute right-0 z-50 min-w-[228px] rounded-md border p-1 shadow-lg',
            placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
          )}
        >
          {actionMode ? (
            <ActionRows
              entries={entries}
              focusIndex={focusIndex}
              onRun={(run) => {
                // Close FIRST and put focus back on the trigger, then run:
                // a dialog the action opens captures the focused element
                // as the place to return to, and that must be the
                // trigger — not an item that is about to unmount.
                close(true);
                run();
              }}
            />
          ) : null}
          {!actionMode && Link !== undefined
            ? items.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  tabIndex={index === focusIndex ? 0 : -1}
                  onClick={() => setOpen(false)}
                  className="text-text-body hover:bg-surface-hover hover:text-text-bright focus-visible:bg-surface-hover focus-visible:text-text-bright flex items-start gap-2.5 rounded-[5px] px-2.5 py-2 focus-visible:outline-none"
                >
                  {item.icon !== undefined ? (
                    <span className="text-text-muted mt-0.5 shrink-0" aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block text-sm leading-tight">{item.label}</span>
                    {item.hint !== undefined ? (
                      <span className="text-text-faint mt-0.5 block text-xs leading-tight">
                        {item.hint}
                      </span>
                    ) : null}
                  </span>
                </Link>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The rows of an action menu. Items are grouped under their label
 * (`role="group"` + `aria-labelledby`) so a screen reader announces
 * "Danger zone" with the items that belong to it; a separator ends a
 * group. Focus order is the order of the ACTION items only.
 */
function ActionRows({
  entries,
  focusIndex,
  onRun,
}: {
  readonly entries: readonly MenuEntry[];
  readonly focusIndex: number;
  readonly onRun: (run: () => void) => void;
}): ReactElement {
  const baseId = useId();
  const nodes: ReactNode[] = [];
  let group = null as ReactNode[] | null;
  let groupLabelId: string | undefined;
  let focusable = 0;
  const flush = (): void => {
    if (group === null) return;
    nodes.push(
      <div key={`g-${groupLabelId ?? nodes.length}`} role="group" aria-labelledby={groupLabelId}>
        {group}
      </div>,
    );
    group = null;
    groupLabelId = undefined;
  };
  for (const entry of entries) {
    if (entry.kind === 'separator') {
      flush();
      nodes.push(<div key={entry.id} role="separator" className="bg-border my-1 h-px" />);
      continue;
    }
    if (entry.kind === 'label') {
      flush();
      groupLabelId = `${baseId}-${entry.id}`;
      group = [
        <div key={entry.id} className="px-2.5 pt-1.5 pb-1">
          <span
            id={groupLabelId}
            className="text-text-faint block text-[11px] font-semibold tracking-wide uppercase"
          >
            {entry.label}
          </span>
          {entry.description !== undefined ? (
            <span className="text-text-faint block text-xs leading-snug">{entry.description}</span>
          ) : null}
        </div>,
      ];
      continue;
    }
    const index = focusable;
    focusable += 1;
    const row = (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        tabIndex={index === focusIndex ? 0 : -1}
        aria-disabled={entry.disabled === true ? true : undefined}
        data-danger={entry.danger === true ? '' : undefined}
        onClick={() => {
          if (entry.disabled === true) return;
          onRun(entry.onSelect);
        }}
        className={clsx(
          'flex w-full items-start gap-2.5 rounded-[5px] px-2.5 py-2 text-start focus-visible:outline-none',
          entry.disabled === true
            ? 'text-text-faint cursor-not-allowed focus-visible:bg-surface-hover'
            : entry.danger === true
              ? 'text-critical hover:bg-[var(--color-critical-tint)] focus-visible:bg-[var(--color-critical-tint)]'
              : 'text-text-body hover:bg-surface-hover hover:text-text-bright focus-visible:bg-surface-hover focus-visible:text-text-bright',
        )}
      >
        {entry.icon !== undefined ? (
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {entry.icon}
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-sm leading-tight">{entry.label}</span>
          {entry.hint !== undefined ? (
            <span className="text-text-faint mt-0.5 block text-xs leading-tight">{entry.hint}</span>
          ) : null}
        </span>
      </button>
    );
    if (group === null) nodes.push(row);
    else group.push(row);
  }
  flush();
  return <>{nodes}</>;
}
