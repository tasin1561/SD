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
      <div className="safe-x mx-auto flex h-10 max-w-7xl items-center justify-between gap-4 sm:px-6">
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

            WHY A TINT AND NOT A FILL. The header directly below carries
            the blue "Request an invite" button, which is the page's
            primary action and must stay the loudest thing in the corner.
            This group has to be FOUND, not obeyed: the tint + line + glow
            roles read as one deliberate object against the flat band
            without competing with a solid fill one row down, and the solid
            is spent on hover, where only the pill a visitor is already
            pointing at takes it. Every colour here is a semantic ROLE pair
            — tint/on-tint, fill/on-fill, line, glow (MKT-1) — so both
            themes resolve by construction and `check-theme.mjs` has a pair
            to check; no raw step appears, and no second accent is added.

            `label` ("Member store sign-in") stays the full phrase and is
            what the drawer, the footer and every screen reader use; the
            pill shows `short` because the rail's own heading already said
            the verb. Bar height went 36 → 40px so a 32px pill keeps air
            above and below it.
          */}
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-line bg-blue-tint py-[3px] pr-[3px] pl-3 shadow-[0_1px_8px_-3px_var(--blue-glow)]">
            <span className="inline-flex items-center gap-1.5 pr-1 font-medium text-blue-on-tint">
              <LogIn size={13} aria-hidden="true" />
              Sign in
            </span>
            {platform.nav.signIn.map((l) => {
              const Icon = CONSOLE_ICON[l.key];
              return (
                <a
                  key={l.href}
                  href={l.href}
                  aria-label={l.label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-blue-on-tint transition-[background-color,color,transform] duration-150 hover:bg-blue-fill hover:text-blue-on-fill focus-visible:outline-2 focus-visible:outline-blue-text focus-visible:outline-offset-2 motion-safe:hover:-translate-y-px motion-reduce:transition-none"
                >
                  {Icon ? <Icon size={13} aria-hidden="true" /> : null}
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
