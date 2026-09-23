'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import './shell.css';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Shell — the app chrome for the product apps, and a SUPERSET of the
 * legacy `AppShell` props: an app switches by changing the import.
 *
 *   ≥ lg (1024px)  sidebar (u23): brand header, icon-chip rows, the
 *                  active row in the accent with a left accent bar that
 *                  SLIDES between rows (one element, transform) and
 *                  follows the pointer, collapsible groups (remembered per
 *                  heading), count badges, the user card at the bottom.
 *                  Top bar (u31): every icon in its own soft button that
 *                  fills and lifts on hover, the notification slot, the
 *                  avatar with a presence dot.
 *   < lg           no sidebar; the top bar's accent menu square opens the
 *                  same nav as a drawer (u20) — a Radix Dialog, so the
 *                  focus trap, Escape and scroll lock come with it; brand
 *                  at the top, a close button, icon chips and chevrons,
 *                  the active row filled, rows staggering in once, and
 *                  theme + motion + sign-out at the bottom.
 *
 * Kept from the legacy shell, on purpose: `aria-current="page"` on the
 * ONE active link (the longest matching href); the
 * `data-slot="nav-rail" | "nav-drawer" | "status-strip"` hooks; a sticky
 * header; the document scrolls (no inner scroll container); `headerAlways`
 * renders ONCE at every width; safe-area insets live on the shell root
 * (and in this file's CSS), never inline beside a padding rule.
 *
 * `themeControl` / `motionControl` are slots (ThemeSwitch and
 * MotionSwitch are built elsewhere). With none passed, nothing renders
 * there — the legacy shell mounted its own ThemeToggle.
 */

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon?: ReactNode;
  /** A count or pill at the end of the row. */
  readonly badge?: ReactNode;
};

export type NavGroup = {
  /** Omit for a single ungrouped list (never collapsible). */
  readonly heading?: string;
  /** Legacy ordinal ("01"). Accepted and ignored: no index numbers. */
  readonly index?: string;
  readonly items: readonly NavItem[];
};

/**
 * `next/link`, passed in so this package takes no Next dependency. Every
 * prop is required, as in the legacy shell — `exactOptionalPropertyTypes`
 * will not unify an optional handler with next/link's own.
 */
export type LinkLike = ComponentType<{
  href: string;
  className: string;
  'aria-current': 'page' | undefined;
  onClick: () => void;
  children: ReactNode;
}>;

function matches(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The single entry to highlight: the LONGEST href that matches. */
export function resolveActiveHref(
  groups: readonly NavGroup[],
  pathname: string | null,
): string | null {
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

const COLLAPSE_KEY = 'sk-nav-collapsed:';

function readCollapsed(groups: readonly NavGroup[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    for (const g of groups) {
      if (g.heading === undefined) continue;
      if (window.localStorage.getItem(COLLAPSE_KEY + g.heading) === '1') out[g.heading] = true;
    }
  } catch {
    // Storage blocked: every group open.
  }
  return out;
}

function writeCollapsed(heading: string, collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(COLLAPSE_KEY + heading, '1');
    else window.localStorage.removeItem(COLLAPSE_KEY + heading);
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
}

function NavList({
  groups,
  activeHref,
  Link,
  variant,
  onNavigate,
}: {
  readonly groups: readonly NavGroup[];
  readonly activeHref: string | null;
  readonly Link: LinkLike;
  readonly variant: 'rail' | 'drawer';
  readonly onNavigate?: (() => void) | undefined;
}): ReactElement {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // The group a person has just OPENED — the only time its rows animate in.
  // Never on mount: the nav re-mounts on every page, and chrome that
  // replays an entrance on each navigation reads as flicker.
  const [justOpened, setJustOpened] = useState<string | null>(null);
  const handleNavigate = onNavigate ?? ((): void => undefined);

  // Stored choices load after mount (storage is browser-only).
  useEffect(() => {
    setCollapsed(readCollapsed(groups));
  }, [groups]);

  const isOpen = (g: NavGroup): boolean => {
    if (g.heading === undefined) return true;
    // The group holding the page you are on is never hidden.
    if (activeHref !== null && g.items.some((i) => i.href === activeHref)) return true;
    return collapsed[g.heading] !== true;
  };

  /* ── The sliding accent bar (rail only) ─────────────────────────── */
  const moveBar = useCallback((row: HTMLElement | null): void => {
    const list = listRef.current;
    if (list === null) return;
    if (row === null || row.offsetParent === null) {
      list.dataset.bar = '0';
      return;
    }
    list.style.setProperty('--bar-y', `${row.offsetTop}px`);
    list.style.setProperty('--bar-h', `${row.offsetHeight}px`);
    list.dataset.bar = '1';
  }, []);
  const toActive = useCallback((): void => {
    moveBar(listRef.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? null);
  }, [moveBar]);

  useIsoLayoutEffect(() => {
    if (variant !== 'rail') return;
    toActive();
    const list = listRef.current;
    if (list === null) return;
    // The first placement must not slide in from the top.
    const id = window.requestAnimationFrame(() => {
      list.dataset.ready = '1';
    });
    return () => window.cancelAnimationFrame(id);
  }, [variant, activeHref, collapsed, toActive]);

  const rowFrom = (target: EventTarget): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('.sk-nav__row') : null;

  let rowIndex = 0;
  return (
    <div
      ref={listRef}
      className="sk-nav"
      data-variant={variant}
      onPointerOver={
        variant === 'rail'
          ? (e) => {
              const row = rowFrom(e.target);
              if (row === null) toActive();
              else moveBar(row);
            }
          : undefined
      }
      onPointerLeave={variant === 'rail' ? toActive : undefined}
      onFocus={
        variant === 'rail'
          ? (e) => {
              const row = rowFrom(e.target);
              if (row !== null) moveBar(row);
            }
          : undefined
      }
      onBlur={variant === 'rail' ? toActive : undefined}
    >
      {variant === 'rail' && <span className="sk-nav__bar" aria-hidden />}
      {groups.map((group, gi) => {
        const open = isOpen(group);
        const regionId = `${baseId}-g${gi}`;
        const heading = group.heading;
        return (
          <div key={heading ?? `group-${gi}`} className="sk-nav__group">
            {heading !== undefined && (
              <button
                type="button"
                className="sk-nav__heading"
                aria-expanded={open}
                aria-controls={regionId}
                onClick={() => {
                  const next = open;
                  setCollapsed((prev) => ({ ...prev, [heading]: next }));
                  writeCollapsed(heading, next);
                  setJustOpened(next ? null : heading);
                }}
              >
                <span className="sk-nav__heading-text">{heading}</span>
                <ChevronDown size={14} className="sk-nav__heading-chev" aria-hidden />
              </button>
            )}
            <div
              id={regionId}
              className="sk-nav__items"
              hidden={!open}
              data-opened={heading !== undefined && heading === justOpened ? '1' : undefined}
            >
              {group.items.map((item) => {
                const active = item.href === activeHref;
                const style = { '--i': rowIndex } as CSSProperties;
                rowIndex += 1;
                return (
                  <div key={item.href} className="sk-nav__cell" style={style}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      onClick={handleNavigate}
                      className="sk-nav__row"
                    >
                      <span className="sk-nav__chip" aria-hidden>
                        {item.icon ?? <span className="sk-nav__dot" />}
                      </span>
                      <span className="sk-nav__label">{item.label}</span>
                      {item.badge !== undefined && (
                        <span className="sk-nav__badge">{item.badge}</span>
                      )}
                      {variant === 'drawer' && (
                        <ChevronRight size={15} className="sk-nav__chev" aria-hidden />
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Two initials from a name or an email — the avatar's glyph. */
export function initialsOf(text: string): string {
  const base = text.includes('@') ? (text.split('@')[0] ?? text) : text;
  const words = base
    .split(/[\s._-]+/)
    .map((w) => w.trim())
    .filter((w) => w !== '');
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** A round avatar with initials and a presence dot. Decorative. */
export function Avatar({
  name,
  size = 32,
  presence = true,
}: {
  readonly name: string;
  readonly size?: number;
  readonly presence?: boolean;
}): ReactElement {
  return (
    <span className="sk-avatar" aria-hidden style={{ '--av': `${size}px` } as CSSProperties}>
      <span className="sk-avatar__initials">{initialsOf(name)}</span>
      {presence && <span className="sk-avatar__dot" />}
    </span>
  );
}

/**
 * HeaderIconButton (u31) — an icon in its own soft rounded button that
 * fills with accent and lifts on hover. `label` is the accessible name
 * (and the tooltip); `count` adds a badge (a notification bell).
 */
export const HeaderIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    readonly label: string;
    readonly icon: ReactNode;
    readonly count?: number | undefined;
    readonly accent?: boolean | undefined;
  }
>(function HeaderIconButton({ label, icon, count, accent = false, className, ...rest }, ref) {
  const shown = count !== undefined && count > 0 ? (count > 99 ? '99+' : String(count)) : null;
  return (
    <button
      ref={ref}
      type="button"
      aria-label={shown === null ? label : `${label} (${shown})`}
      title={label}
      className={clsx('sk-iconbtn', className)}
      data-accent={accent ? '1' : undefined}
      {...rest}
    >
      <span className="sk-iconbtn__icon" aria-hidden>
        {icon}
      </span>
      {shown !== null && (
        <span className="sk-iconbtn__count sk-figure" aria-hidden>
          {shown}
        </span>
      )}
    </button>
  );
});

function BrandMark({
  src,
  height,
}: {
  readonly src: string;
  readonly height: number;
}): ReactElement {
  return (
    // A plain <img>: this package takes no Next dependency.
    <img
      src={src}
      alt=""
      aria-hidden="true"
      height={height}
      width={Math.round(height * (1092 / 532))}
      className="sk-brand__mark"
      style={{ height, width: 'auto' }}
      draggable={false}
    />
  );
}

function Identity({
  primary,
  secondary,
  href,
  Link,
  onNavigate,
  align = 'left',
}: {
  readonly primary: string;
  readonly secondary: string;
  readonly href?: string | undefined;
  readonly Link: LinkLike;
  readonly onNavigate?: (() => void) | undefined;
  readonly align?: 'left' | 'right';
}): ReactElement {
  const inner = (
    <>
      <Avatar name={primary} />
      <span className="sk-identity__text" data-align={align}>
        <span className="sk-identity__primary">{primary}</span>
        <span className="sk-identity__secondary">{secondary}</span>
      </span>
    </>
  );
  if (href === undefined) return <div className="sk-identity">{inner}</div>;
  return (
    <Link
      href={href}
      className="sk-identity sk-identity--link"
      aria-current={undefined}
      onClick={onNavigate ?? ((): void => undefined)}
    >
      {inner}
    </Link>
  );
}

export function Shell({
  brand = 'Skydrop',
  logoSrc = '/brand/skydrop-icon.svg',
  subtitle,
  sectionLabel,
  navGroups,
  identityPrimary,
  identitySecondary,
  identityHref,
  headerActions,
  headerAlways,
  headerCenter,
  drawerActions,
  footerNote,
  statusStrip,
  themeControl,
  motionControl,
  pathname,
  Link,
  onSignOut,
  signingOut = false,
  contained = false,
  children,
}: {
  readonly brand?: string;
  /** Served from the app's own origin (FE-3). */
  readonly logoSrc?: string;
  /** "Admin" / "Seller" — the line under the wordmark. */
  readonly subtitle: string;
  /** Quiet context label in the desktop top bar. */
  readonly sectionLabel: string;
  readonly navGroups: readonly NavGroup[];
  readonly identityPrimary: string;
  readonly identitySecondary: string;
  readonly identityHref?: string | undefined;
  /** Desktop-only top-bar controls, left of the identity. */
  readonly headerActions?: ReactNode;
  /** The one action that stays in the bar on a phone (the notification bell). */
  readonly headerAlways?: ReactNode;
  /** The centre of the header (a global search). */
  readonly headerCenter?: ReactNode;
  /** The same actions for the drawer footer (menus there open upward). */
  readonly drawerActions?: ReactNode;
  readonly footerNote?: string | undefined;
  /** A thin strip of standing facts along the bottom of the content. */
  readonly statusStrip?: ReactNode;
  /** ThemeSwitch — rendered in the top bar and the drawer. */
  readonly themeControl?: ReactNode;
  /** MotionSwitch — rendered in the sidebar's user card and the drawer. */
  readonly motionControl?: ReactNode;
  readonly pathname: string | null;
  readonly Link: LinkLike;
  readonly onSignOut: () => void;
  readonly signingOut?: boolean;
  /** Fill a containing frame instead of the viewport (the gallery). */
  readonly contained?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeHref = resolveActiveHref(navGroups, pathname);
  const signOutLabel = signingOut ? 'Signing out…' : 'Sign out';

  // Close on navigation: the route changes under an open drawer otherwise.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="sk-shell" data-contained={contained ? '1' : undefined}>
      {/* ── Sidebar (u23) ─────────────────────────────────────────── */}
      <aside data-slot="nav-rail" className="sk-rail">
        <div className="sk-brand sk-rail__brand">
          <BrandMark src={logoSrc} height={26} />
          <span className="sk-brand__text">
            <span className="sk-brand__name">{brand}</span>
            <span className="sk-brand__sub">{subtitle}</span>
          </span>
        </div>
        <nav className="sk-rail__nav" aria-label="Main">
          <NavList groups={navGroups} activeHref={activeHref} Link={Link} variant="rail" />
        </nav>
        {footerNote !== undefined && <div className="sk-rail__note">{footerNote}</div>}
        <div className="sk-rail__user">
          <Identity
            primary={identityPrimary}
            secondary={identitySecondary}
            href={identityHref}
            Link={Link}
          />
          {motionControl !== undefined && <div className="sk-rail__motion">{motionControl}</div>}
        </div>
      </aside>

      {/* ── Main column ───────────────────────────────────────────── */}
      <div className="sk-shell__main">
        <header className="sk-top">
          <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <Dialog.Trigger asChild>
              <button type="button" aria-label="Open navigation menu" className="sk-top__menu">
                <Menu size={18} aria-hidden />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="sk-drawer__overlay" />
              <Dialog.Content aria-label="Navigation" data-slot="nav-drawer" className="sk-drawer">
                <div className="sk-drawer__head">
                  <div className="sk-brand">
                    <BrandMark src={logoSrc} height={26} />
                    <Dialog.Title className="sk-brand__text">
                      <span className="sk-brand__name">{brand}</span>
                      <span className="sk-brand__sub">{subtitle}</span>
                    </Dialog.Title>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="Close navigation menu"
                      className="sk-iconbtn sk-drawer__close"
                    >
                      <span className="sk-iconbtn__icon" aria-hidden>
                        <X size={18} />
                      </span>
                    </button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sk-shell__sr">
                  Main navigation and account actions
                </Dialog.Description>
                <nav className="sk-drawer__nav" aria-label="Main">
                  <NavList
                    groups={navGroups}
                    activeHref={activeHref}
                    Link={Link}
                    variant="drawer"
                    onNavigate={() => setDrawerOpen(false)}
                  />
                </nav>
                <div className="sk-drawer__foot">
                  {drawerActions}
                  {(themeControl !== undefined || motionControl !== undefined) && (
                    <div className="sk-drawer__prefs">
                      {themeControl}
                      {motionControl}
                    </div>
                  )}
                  <div className="sk-drawer__account">
                    <Identity
                      primary={identityPrimary}
                      secondary={identitySecondary}
                      href={identityHref}
                      Link={Link}
                      onNavigate={() => setDrawerOpen(false)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={onSignOut}
                    disabled={signingOut}
                    className="sk-drawer__signout"
                  >
                    <LogOut size={16} aria-hidden />
                    {signOutLabel}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="sk-brand sk-top__brand">
            <BrandMark src={logoSrc} height={22} />
            <span className="sk-brand__name">{brand}</span>
            <span className="sk-brand__sub sk-top__brand-sub">{subtitle}</span>
          </div>

          <div className="sk-top__section">{sectionLabel}</div>
          {headerCenter !== undefined && <div className="sk-top__center">{headerCenter}</div>}
          <div className="sk-top__right">
            {headerAlways}
            <div className="sk-top__desktop">
              {headerActions}
              {themeControl}
              <Identity
                primary={identityPrimary}
                secondary={identitySecondary}
                href={identityHref}
                Link={Link}
                align="right"
              />
              <HeaderIconButton
                label={signOutLabel}
                icon={<LogOut size={16} />}
                onClick={onSignOut}
                disabled={signingOut}
              />
            </div>
          </div>
        </header>

        <main className="sk-shell__content">{children}</main>

        {statusStrip !== undefined && (
          <div data-slot="status-strip" className="sk-shell__strip">
            {statusStrip}
          </div>
        )}
      </div>
    </div>
  );
}
