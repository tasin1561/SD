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
  items,
  Link,
  /** In the mobile drawer the trigger sits at the bottom of the screen,
   *  so a menu opening downward would be off-screen. */
  placement = 'below',
  className,
}: {
  readonly label: string;
  readonly items: readonly MenuAction[];
  readonly Link: MenuLinkLike;
  readonly placement?: 'below' | 'above';
  readonly className?: string;
}): ReactElement | null {
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
      openAt(items.length - 1);
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
        setFocusIndex((i) => (i + 1) % items.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusIndex((i) => (i - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusIndex(items.length - 1);
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
  if (items.length === 0) return null;

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <Button
        ref={triggerRef}
        size="md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) setOpen(false);
          else openAt(0);
        }}
        onKeyDown={onTriggerKeyDown}
        className="w-full justify-center lg:w-auto"
      >
        {label}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={clsx('transition-transform', open && 'rotate-180')}
        />
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
          {items.map((item, index) => (
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
          ))}
        </div>
      ) : null}
    </div>
  );
}
