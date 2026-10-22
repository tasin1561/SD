import { Building2, Store, UserRound, type LucideIcon } from 'lucide-react';

/**
 * The console each sign-in link leads to, by the same `key` the shared
 * console directory uses (`@skydrop/ui/app/sign-in` → `ConsoleKey`), and
 * THE SAME THREE ICONS that directory draws on every console's sign-in
 * page. That repetition is the point: a returning member store sees the
 * shop mark here, taps it, and the page that opens is headed by the same
 * mark and the same two words. Icons are the one thing a visitor
 * recognises before reading anything, which is what makes the group
 * findable at a glance instead of being more words of grey text.
 *
 * IT LIVES IN ITS OWN FILE because the marketing site offers these links
 * in two places that cannot share a component — the desktop utility bar
 * (a server component) and the mobile drawer (inside `'use client'`
 * `SiteHeader`). One map keeps the two surfaces from drifting the way
 * the consoles' own sign-in links did before CON-2 gave them one list.
 */
export const CONSOLE_ICON: Record<string, LucideIcon> = {
  client: Building2,
  store: Store,
  associate: UserRound,
};
