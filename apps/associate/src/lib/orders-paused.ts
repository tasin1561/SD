import type { StoreMe } from '@skydrop/api-client';

/**
 * ASSOC-1 — has the store switched this person's order creation off?
 *
 * `store_users.orders_paused_at` gates `orders.create` ONLY: everything
 * already placed carries on, and they keep reading, tracking, cancelling
 * and chasing it.
 *
 * ── THIS IS THE COURTESY HALF, NOT THE CONTROL ──────────────────────
 * The server refuses a create with `ASSOCIATE_ORDERS_PAUSED` whatever
 * this says, and the order form surfaces that refusal verbatim (FE-2).
 * What this adds is a standing notice at the TOP of the form, so nobody
 * fills a whole order in to be refused at the end.
 *
 * The form is deliberately NOT disabled by it. The pause can be switched
 * on between the page load and the submit, so a disabled form would be
 * both wrong sometimes and useless always: a form that cannot be opened
 * reads as broken software, where one that explains why it will not go
 * through tells somebody to ring their store.
 */
export function ordersPaused(me: Pick<StoreMe, 'ordersPausedAt'> | null): boolean {
  return me !== null && me.ordersPausedAt !== null && me.ordersPausedAt !== '';
}

/**
 * Does this person see only what they placed?
 *
 * COPY ONLY. `store_roles.order_scope` is applied in the server's WHERE
 * clause, so the rows are narrowed whatever this returns; it exists so
 * the orders and customers screens can say "the ones you placed" once,
 * plainly, instead of leaving somebody wondering where the rest went.
 */
export function seesOwnOnly(me: Pick<StoreMe, 'orderScope'> | null): boolean {
  return me !== null && me.orderScope === 'OWN';
}
