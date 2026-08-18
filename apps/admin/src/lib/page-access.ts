import type { StaffMe } from '@skydrop/api-client';

/**
 * Which admin pages each permission opens.
 *
 * ── COSMETIC ONLY (FE-2) ─────────────────────────────────────────────
 * This hides links and blocks routes somebody cannot use. It is NOT the
 * security boundary — the API's permission guard is, and it refuses the
 * request whatever this table says. Keeping the two in step is a
 * courtesy: without it a person sees twenty-nine menu items, clicks one,
 * and learns from a 403 that it was never theirs.
 *
 * ── ONE TABLE, TWO CONSUMERS ─────────────────────────────────────────
 * The nav filter and the route boundary both read from HERE. Two lists
 * drift, and both failure modes are ugly: a menu link to a page that
 * refuses to render, or a reachable page with no way to navigate to it.
 * `apps/seller/src/lib/role-access.ts` is the same pattern for the
 * seller app; this is its permission-shaped equivalent.
 *
 * ── MATCHING ─────────────────────────────────────────────────────────
 * Longest prefix wins, so `/inventory/adjustments` can need something
 * different from `/inventory`. A path matching NOTHING is allowed
 * through — the boundary's job is to enforce the table, not to be a
 * second router. `/dashboard` is deliberately open to every staff
 * member: it is where sign-in lands, and a landing page that 403s is a
 * bad first impression of a system that is working correctly.
 */
export const PAGE_PERMISSIONS: ReadonlyArray<readonly [prefix: string, permission: string]> = [
  ['/orders', 'orders.view'],
  ['/call-center/queue', 'callcenter.queue.view'],
  // READING the agent list is `callcenter.queue.view`; only changing
  // somebody's settings is `callcenter.agents.manage`. Gating the page
  // on the write permission meant a role that could manage agents but
  // not read the queue opened a page that 403'd on its own data.
  ['/call-center/agents', 'callcenter.queue.view'],
  ['/call-center', 'callcenter.work'],
  ['/warehouse', 'warehouse.view'],
  // The whole page is pickups, so it needs the pickup permission — not
  // the warehouse one it inherited from the prefix above.
  ['/warehouse/pickups', 'courier.pickups.manage'],
  ['/tickets', 'tickets.view'],
  ['/holds', 'holds.manage'],
  // The index had NO entry, so it fell through as ungated and every
  // staff member could open it and watch its queries refuse.
  ['/inventory', 'inventory.view'],
  ['/inventory/adjustments', 'inventory.view'],
  ['/inventory/cycle-counts', 'inventory.view'],
  ['/inventory/movements', 'inventory.view'],
  ['/inventory/transfers', 'inventory.view'],
  ['/inventory-units', 'inventory.view'],
  ['/settlements', 'money.view'],
  ['/withdrawals', 'money.view'],
  ['/topups', 'money.view'],
  ['/remittances', 'money.view'],
  // A payout destination is money, not seller admin — and the API
  // guards all three of its endpoints on this one permission.
  ['/bank-changes', 'sellers.bank_change.approve'],
  ['/freight', 'money.view'],
  ['/margin', 'courier.margin.view'],
  ['/pricing', 'pricing.preview'],
  ['/fx', 'fx.view'],
  ['/leads', 'leads.view'],
  ['/sellers', 'sellers.view'],
  ['/courier-accounts', 'courier.accounts.view'],
  ['/delhivery', 'courier.waybills.manage'],
  ['/courier-escalation', 'courier.ops.view'],
  ['/reports', 'reports.view'],
  ['/webhooks', 'webhooks.view'],
  ['/staff', 'staff.view'],
  ['/roles', 'rbac.manage'],
  ['/system/capacity', 'system.capacity.view'],
  ['/settings', 'system.settings.view'],
];

/** The permission a path needs, or null when it needs none. */
export function permissionForPath(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of PAGE_PERMISSIONS) {
    if (pathname === entry[0] || pathname.startsWith(`${entry[0]}/`)) {
      if (best === null || entry[0].length > best[0].length) best = entry;
    }
  }
  return best?.[1] ?? null;
}

export function canSeePath(identity: Pick<StaffMe, 'permissions'>, pathname: string): boolean {
  const needed = permissionForPath(pathname);
  return needed === null || identity.permissions.includes(needed);
}

/**
 * Where somebody lands when the page they asked for is not theirs.
 *
 * The dashboard, because every staff member may see it. Sending them to
 * the first page they CAN see would be cleverer and worse: it varies by
 * role, so two people describing "the page it sent me to" would not be
 * describing the same page.
 */
export const FALLBACK_PATH = '/dashboard';
