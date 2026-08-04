'use client';

import { hasPermission, useStaffIdentity } from '@skydrop/auth/client';

/**
 * Whether the signed-in staff member holds ANY of these permissions.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────
 * Deciding what to RENDER. The nav and the route boundary handle whole
 * pages (`page-access.ts`); this is the finer grain — a section, a tile,
 * a button — on a page somebody is legitimately allowed to open.
 *
 * The dashboard is why it exists. It is the one page open to every staff
 * member, and it was firing eight queries regardless of who was looking:
 * a call agent got a red "403 — does not hold reports.view" across the
 * bottom of their own landing page, plus two tiles stuck as grey
 * rectangles forever because their requests had failed and the tile only
 * knew how to show a skeleton. Everything was working exactly as
 * designed; the design was asking for things and then displaying the
 * refusal.
 *
 * ── USE IT ON THE QUERY, NOT JUST THE MARKUP ─────────────────────────
 * Hiding a section while still fetching its data leaves the 403 in the
 * server log and spends the round trip anyway. Pass the result to the
 * query's `enabled` as well, so a request nobody may make is never
 * issued.
 *
 * ── STILL COSMETIC (FE-2) ────────────────────────────────────────────
 * This decides what is shown. The API decides what is permitted, and
 * refuses whatever was rendered. A stale identity here is a slightly
 * wrong screen, never an escalation.
 */
export function usePermission(...anyOf: readonly string[]): boolean {
  return hasPermission(useStaffIdentity(), ...anyOf);
}
