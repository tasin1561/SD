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
 * `apps/seller/src/lib/page-access.ts` is the same pattern for the
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
  // The inbox itself is deliberately ABSENT: it is self-service on the
  // API (a person's own rows, addressed by the id on their token), so
  // gating the page would refuse a screen the server would serve.
  // Sending TO an audience is the opposite kind of act.
  ['/notifications/broadcasts', 'notifications.broadcast'],
  ['/orders', 'orders.view'],
  ['/call-center/queue', 'callcenter.queue.view'],
  // Approving one is what returns a declined order to the queue, so it
  // is gated on the same permission that manages the queue itself.
  ['/reattempt-requests', 'callcenter.queue.manage'],
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
  ['/system-issues', 'system.settings.view'],
  ['/nsa', 'orders.view'],
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
  ['/seller-wallets', 'money.view'],
  ['/topups', 'money.view'],
  ['/bank-accounts', 'money.view'],
  // Seeing what we hold is an ordinary finance question; recording a
  // movement is gated separately on money.treasury.manage at the API.
  ['/treasury', 'money.treasury.view'],
  // The P&L reads the same ledgers the treasury does, plus the wallet
  // and charge tables — everything it shows is money, so the treasury
  // gate is the right one rather than a new permission nobody holds.
  ['/pnl', 'money.treasury.view'],
  // Expenses and investments are OUR money by construction: client
  // money is neither spendable nor investable, so this never widens
  // beyond the treasury view.
  ['/expenses', 'money.treasury.view'],
  // What we owe against what we are owed. Same ledgers, same gate.
  ['/liabilities', 'money.treasury.view'],
  // Sellers asking us to act on a failed delivery. Reading the queue is
  // an order-desk job; approving one dispatches a van and is gated
  // separately on the courier permission at the endpoint.
  ['/delivery-actions', 'orders.view'],
  // The whole page is the manual-placement worklist and its only query
  // needs that permission, so gating it here hides the nav entry too —
  // rather than showing a link to a page that 403s on load.
  ['/manual-placement', 'courier.manual_placement'],
  ['/warehouse/printing', 'warehouse.pick'],
  ['/warehouse/handover', 'courier.dispatch.handoff'],
  ['/remittances', 'money.view'],
  // A withdrawal destination is money, not seller admin — and the API
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
