'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { Menu, X } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactElement, type ReactNode } from 'react';

/**
 * The application shell — sidebar, topbar, content column.
 *
 * ── WHY THIS IS SHARED ───────────────────────────────────────────────
 * apps/admin and apps/seller had two near-identical copies, both
 * `grid-cols-[220px_1fr]` at EVERY width. On a 360px phone that leaves
 * 140px of content, and every page in both apps overflowed the viewport
 * by exactly 122px. Fixing it twice would have left two shells to drift
 * apart again, so the chrome lives here and the apps pass their nav.
 *
 * This is the same identity-parameterization as `@skydrop/api-client`
 * and `@skydrop/auth` (FE-5): staff and seller share the mechanics, and
 * what differs — nav, brand line, the two identity lines — is a prop.
 *
 * ── THE RESPONSIVE MODEL ─────────────────────────────────────────────
 * `lg` (1024px) is the one breakpoint that matters:
 *
 *   ≥ lg   persistent sidebar, identity and sign-out in the top bar.
 *   < lg   no sidebar; a sticky top bar carries a menu button that
 *          opens the same nav as an off-canvas drawer. Identity and
 *          sign-out move into the drawer footer, which is where a
 *          phone user expects account actions to live.
 *
 * The drawer is a Radix Dialog rather than a hand-rolled panel, so it
 * inherits the focus trap, scroll lock, Escape-to-close and correct
 * aria wiring — the parts of a drawer that are easy to omit and are
 * exactly what a keyboard or screen-reader user depends on.
 *
 * ── SCROLLING ────────────────────────────────────────────────────────
 * The document scrolls; the shell does not create an inner scroll
 * container. The previous `<main className="overflow-auto">` did, which
 * on iOS breaks momentum scrolling and stops the URL bar collapsing —
 * the page feels wrong in a way that is hard to name. The sidebar gets
 * its own `sticky` + `overflow-y-auto` instead, so a long nav still
 * scrolls independently on desktop.
 *
 * `min-h-dvh` rather than `min-h-screen`: `vh` on mobile Safari counts
 * the space UNDER the browser chrome, so `100vh` is taller than what
 * you can actually see and leaves a phantom scroll.
 */

export type NavItem = {
  readonly href: string;
  readonly label: string;
  /** Rendered at 15px in both the sidebar and the drawer. */
  readonly icon?: ReactNode;
};

export type NavGroup = {
  /** Omit for a single ungrouped list. */
  readonly heading?: string;
  readonly items: readonly NavItem[];
};

/**
 * `next/link`, passed in so this package does not take a dependency on
 * Next.
 *
 * Every prop is required rather than optional, and the shell always
 * passes all of them: `exactOptionalPropertyTypes` will not unify an
 * optional `onClick?: () => void` with next/link's
 * `onClick?: MouseEventHandler`, so declaring them optional here makes
 * `Link={Link}` fail to compile in both apps.
 */
export type LinkLike = ComponentType<{
  href: string;
  className: string;
  'aria-current': 'page' | undefined;
  onClick: () => void;
  children: ReactNode;
}>;

/**
 * Matches when the path IS the href, or is a child segment of it.
 *
 * The trailing `/` matters: a plain `startsWith` makes `/inventory`
 * light up on `/inventory-units`, which is a different page in a
 * different section.
 */
function matches(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The single nav entry to highlight: the LONGEST href that matches.
 *
 * Several entries can legitimately match one path — `/settings` and
 * `/settings/addresses` both match `/settings/addresses`, as do
 * `/call-center` and `/call-center/queue`. Highlighting each match
 * lights up two rows at once, which reads as a rendering bug rather
 * than as a hierarchy. The most specific one is the page you are on.
 */
function resolveActiveHref(groups: readonly NavGroup[], pathname: string | null): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (matches(pathname, item.href) && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}

function NavLinks({
  groups,
  pathname,
  Link,
  onNavigate,
}: {
  readonly groups: readonly NavGroup[];
  readonly pathname: string | null;
  readonly Link: LinkLike;
  /** Closes the drawer after a tap. Undefined on desktop. */
  readonly onNavigate?: () => void;
}): ReactElement {
  const activeHref = resolveActiveHref(groups, pathname);
  // Always a function — see the note on LinkLike. On desktop there is
  // no drawer to close, so it does nothing.
  const handleNavigate = onNavigate ?? ((): void => {});
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.heading ?? `group-${gi}`} className="mb-1">
          {group.heading !== undefined && (
            <div className="text-text-faint px-4 pt-3 pb-1 text-[10px] font-semibold tracking-[0.09em] uppercase">
              {group.heading}
            </div>
          )}
          {group.items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={handleNavigate}
                className={clsx(
                  // 40px min height: a nav row is the most-tapped
                  // target in the app and was 30px.
                  'mx-2 my-0.5 flex min-h-[40px] items-center gap-2.5 rounded-[6px] px-3 text-sm transition-colors',
                  active
                    ? 'bg-surface-hover text-text-bright font-medium'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-body',
                )}
              >
                {item.icon !== undefined && (
                  <span
                    aria-hidden
                    className={clsx(
                      'flex w-[15px] shrink-0 items-center justify-center',
                      active ? 'text-accent' : 'text-text-faint',
                    )}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function BrandBlock({
  brand,
  subtitle,
  className,
}: {
  readonly brand: string;
  readonly subtitle: string;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={className}>
      <div className="text-text-bright text-[15px] leading-tight font-semibold tracking-tight">
        {brand}
      </div>
      <div className="text-text-faint mt-0.5 text-[11px] tracking-wide uppercase">{subtitle}</div>
    </div>
  );
}

function SignOutButton({
  onSignOut,
  signingOut,
  className,
}: {
  readonly onSignOut: () => void;
  readonly signingOut: boolean;
  readonly className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={signingOut}
      className={clsx(
        'border-border text-text-muted hover:border-border-strong hover:text-text-body inline-flex min-h-[36px] items-center rounded-[6px] border px-3 text-xs font-medium transition-colors disabled:opacity-50',
        className,
      )}
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export function AppShell({
  brand = 'Skydrop',
  subtitle,
  sectionLabel,
  navGroups,
  identityPrimary,
  identitySecondary,
  footerNote,
  pathname,
  Link,
  onSignOut,
  signingOut = false,
  children,
}: {
  readonly brand?: string;
  /** "Admin" / "Seller" — the line under the wordmark. */
  readonly subtitle: string;
  /** Quiet context label in the desktop top bar. */
  readonly sectionLabel: string;
  readonly navGroups: readonly NavGroup[];
  /** Staff email, or the seller's company name. */
  readonly identityPrimary: string;
  /** Staff role, or the seller user's email. */
  readonly identitySecondary: string;
  readonly footerNote?: string;
  readonly pathname: string | null;
  readonly Link: LinkLike;
  readonly onSignOut: () => void;
  readonly signingOut?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close on navigation. Radix will not do this for us — the route
  // changes underneath an open drawer and it would stay open over the
  // page the user just asked for.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="bg-bg text-text-body flex min-h-dvh">
      {/* ── Desktop sidebar ───────────────────────────────────────── */}
      <aside
        className="border-border bg-surface hidden w-[236px] shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-dvh"
        style={{ paddingLeft: 'env(safe-area-inset-left)' }}
      >
        <BrandBlock
          brand={brand}
          subtitle={subtitle}
          className="border-border shrink-0 border-b px-4 py-4"
        />
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Main">
          <NavLinks groups={navGroups} pathname={pathname} Link={Link} />
        </nav>
        {footerNote !== undefined && (
          <div className="border-border text-text-faint shrink-0 border-t px-4 py-3 text-[11px]">
            {footerNote}
          </div>
        )}
      </aside>

      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="border-border bg-surface/95 sticky top-0 z-30 flex min-h-[52px] items-center gap-3 border-b px-3 backdrop-blur sm:px-5 lg:px-6"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          {/* Mobile: menu + brand. Hidden once the sidebar appears. */}
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="Open navigation menu"
                className="text-text-muted hover:text-text-bright hover:bg-surface-hover -ml-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] transition-colors lg:hidden"
              >
                <Menu size={18} />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-40 bg-black/60 lg:hidden" />
              <Dialog.Content
                aria-label="Navigation"
                className="bg-surface border-border fixed inset-y-0 left-0 z-50 flex w-[min(86vw,300px)] flex-col border-r shadow-[var(--shadow-3)] focus:outline-none lg:hidden"
                style={{
                  paddingTop: 'env(safe-area-inset-top)',
                  paddingBottom: 'env(safe-area-inset-bottom)',
                  paddingLeft: 'env(safe-area-inset-left)',
                }}
              >
                <div className="border-border flex shrink-0 items-center justify-between border-b px-4 py-3">
                  {/* Rendered directly rather than via `asChild` — that
                      needs a ref-forwarding child, and a plain function
                      component silently drops it, leaving the dialog
                      with no accessible name. */}
                  <Dialog.Title className="text-text-bright text-[15px] leading-tight font-semibold tracking-tight">
                    {brand}
                    <span className="text-text-faint mt-0.5 block text-[11px] font-normal tracking-wide uppercase">
                      {subtitle}
                    </span>
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close navigation menu"
                      className="text-text-muted hover:text-text-bright hover:bg-surface-hover -mr-1 inline-flex h-10 w-10 items-center justify-center rounded-[6px] transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </div>
                {/* Radix wants a description; the nav needs no prose. */}
                <Dialog.Description className="sr-only">
                  Main navigation and account actions
                </Dialog.Description>
                <nav className="flex-1 overflow-y-auto py-2" aria-label="Main">
                  <NavLinks
                    groups={navGroups}
                    pathname={pathname}
                    Link={Link}
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </nav>
                {/* Account actions live at the bottom of the drawer on
                    mobile — there is no room for them in a 52px bar,
                    and this is where a phone user looks for them. */}
                <div className="border-border shrink-0 space-y-2.5 border-t px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-text-body truncate text-xs font-medium">
                      {identityPrimary}
                    </div>
                    <div className="text-text-faint truncate text-[11px]">{identitySecondary}</div>
                  </div>
                  <SignOutButton
                    onSignOut={onSignOut}
                    signingOut={signingOut}
                    className="w-full justify-center"
                  />
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="min-w-0 flex-1 lg:hidden">
            <span className="text-text-bright truncate text-sm font-semibold tracking-tight">
              {brand}
            </span>
            <span className="text-text-faint ml-1.5 text-[11px] tracking-wide uppercase">
              {subtitle}
            </span>
          </div>

          {/* Desktop: context label + identity + sign out. */}
          <div className="text-text-faint hidden min-w-0 flex-1 text-[11px] tracking-[0.08em] uppercase lg:block">
            {sectionLabel}
          </div>
          <div className="hidden shrink-0 items-center gap-3 lg:flex">
            <div className="min-w-0 text-right leading-tight">
              <div className="text-text-body truncate text-xs">{identityPrimary}</div>
              <div className="text-text-faint truncate text-[11px]">{identitySecondary}</div>
            </div>
            <SignOutButton onSignOut={onSignOut} signingOut={signingOut} />
          </div>
        </header>

        <main
          className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6"
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)',
            paddingRight: 'max(env(safe-area-inset-right), 0px)',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
