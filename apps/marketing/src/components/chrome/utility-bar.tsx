import { Building2, Clock, LogIn, Phone, Store, UserRound, type LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { business, platform } from '@/content/site';

/**
 * The console each sign-in pill leads to, by the same `key` the shared
 * console directory uses (`@skydrop/ui/app/sign-in` → `ConsoleKey`), and
 * THE SAME THREE ICONS that directory draws on every console's sign-in
 * page. That repetition is the point: a returning member store sees the
 * shop mark here, clicks it, and the page that opens is headed by the
 * same mark and the same two words. Icons are the one thing a visitor
 * recognises before they have read anything, which is what makes this
 * row findable at a glance rather than four more words of grey text.
 */
const CONSOLE_ICON: Record<string, LucideIcon> = {
  client: Building2,
  store: Store,
  associate: UserRound,
};

/**
 * The thin bar ABOVE the header — the corporate-courier convention every
 * reference site carries (Shiprocket's runs a promo; ours runs the facts a
 * visitor wants before reading anything: how to ring us, when we answer,
 * and where to sign in). Hidden below `md`: on a phone the same three
 * facts live in the floating contact fan and the drawer.
 */
export function UtilityBar(): ReactElement {
  return (
    <div className="hidden border-b border-line bg-surface-band text-[13px] text-fg-muted md:block">
      <div className="safe-x mx-auto flex h-11 max-w-7xl items-center justify-between gap-4 sm:px-6">
        <div className="flex items-center gap-5">
          <a
            href={business.hotlineHref}
            className="inline-flex items-center gap-1.5 font-medium text-fg-body hover:text-fg-strong"
          >
            <Phone size={13} aria-hidden="true" />
            <span className="tabular">{business.hotline}</span>
          </a>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} aria-hidden="true" />
            {business.hoursDays} · {business.hoursTime} ({business.hoursZone})
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a href={platform.nav.track.href} className="hover:text-fg-strong">
            {platform.nav.track.label}
          </a>
          {/*
            THE SIGN-INS ARE ONE HIGHLIGHTED GROUP (owner, 2026-10-22).
            They used to be three more plain links in a row of four, so the
            one thing a returning client, member store or associate comes
            here to do read exactly like the parcel lookup beside it — and
            the row said "sign-in" three times to carry the verb. One rail
            says it once and holds three named pills instead.

            LOUD BY DECISION, not by default (owner, same day). The first
            cut was a quiet tint: the header below carries the blue
            "Request an invite", the page's primary action, and a second
            blue group in the same corner competes with it. The owner
            asked for the sign-ins to seek attention anyway — returning
            users are the traffic that matters while the site is
            invite-only — so the pills now carry the SOLID fill at rest
            and sit on a raised surface capsule that lifts the whole group
            off the flat band. Stated plainly so the next person reads a
            decision here rather than an accident: the invite button is no
            longer the only strong thing in this corner.

            Every colour is still a semantic ROLE pair — fill/on-fill,
            fill-hover, line, glow (MKT-1) — so both themes resolve by
            construction, `check-theme.mjs` has a pair to check, and no
            raw step or new accent appears. The motion is the page's OWN
            entrance primitive (`boot-rise`, transform-only, staggered 80ms
            per pill, `backwards` fill), which globals.css already answers
            for `prefers-reduced-motion`; nothing here loops, because a
            chrome element that pulses forever reads cheap by the second
            scroll and is the one thing a utility bar cannot take back.

            `label` ("Member store sign-in") stays the full phrase and is
            what the drawer, the footer and every screen reader use; the
            pill shows `short` because the rail's own heading already said
            the verb. Bar height 36 → 40 → 44px as the group grew.
          */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-line bg-surface py-1 pr-1 pl-3 shadow-[0_4px_14px_-4px_var(--blue-glow)]">
            <span className="inline-flex items-center gap-1.5 pr-0.5 font-semibold text-fg-strong">
              <LogIn size={14} className="text-blue-text" aria-hidden="true" />
              Sign in
            </span>
            {platform.nav.signIn.map((l, i) => {
              const Icon = CONSOLE_ICON[l.key];
              return (
                <a
                  key={l.href}
                  href={l.href}
                  aria-label={l.label}
                  className={`boot-rise${i > 0 ? ` boot-rise-${i + 1}` : ''} inline-flex items-center gap-1.5 rounded-full bg-blue-fill px-3 py-1.5 font-semibold text-blue-on-fill shadow-sm transition-[background-color,transform] duration-150 hover:bg-blue-fill-hover focus-visible:outline-2 focus-visible:outline-blue-text focus-visible:outline-offset-2 motion-safe:hover:-translate-y-px motion-reduce:transition-none`}
                >
                  {Icon ? <Icon size={14} aria-hidden="true" /> : null}
                  {l.short}
                </a>
              );
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
