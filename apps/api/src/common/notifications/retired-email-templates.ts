/**
 * The email legs RETIRED in favour of the inbox (owner, 2026-09-20),
 * and — for each — the in-app topic that now carries the message.
 *
 * ── WHY A MAP AND NOT A SET ──────────────────────────────────────────
 * Because the thing worth checking is not "is this code switched off"
 * but "where did the message GO". Dropping an email leg only moves a
 * notification to another channel if that other channel exists and is
 * addressed to the right people; without one it does not retire the
 * message, it DELETES it — silently, since nothing fails when nobody is
 * told. Naming the replacement topic here makes that checkable:
 * `retired-email-templates.spec.ts` asserts every value is a topic the
 * catalogue actually serves (NOTIF-17), so a code added here with no
 * inbox route fails the build rather than quietly dropping mail.
 *
 * The topic is usually the template code without its `.email` suffix
 * (NOTIF-14) — but NOT always: the three ticket emails are carried by
 * `ticket.*` topics named for the EVENT rather than the recipient.
 * Deriving it would have been wrong for exactly those three, which is
 * the other reason this is a map.
 *
 * ── WHY ONE LIST RATHER THAN A FLAG PER SENDER ───────────────────────
 * These templates are sent from eleven services by three different
 * mechanisms (the NOTIF-4 lifecycle table, the audience dispatcher, and
 * the pre-M11 direct `EmailQueue` callers). A flag at each call site is
 * eleven places to keep one decision in, and the decision is a property
 * of the MESSAGE, not of whichever code happens to send it. Senders are
 * left composing their email exactly as they did — the gate sits at the
 * two points every email must pass — so putting one back is deleting a
 * line here, not restoring a deleted code path.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────
 * CREDENTIAL templates for all three identities (NOTIF-9 makes email the
 * only channel structurally — an invitation has no account to be read
 * from, and a password reset you must be signed in to read is useless);
 * every `customer.*` template (no customer login in Phase-1A);
 * `marketing.invite_lead_ack.email` (the lead has no account); and the
 * CRITICAL `system_issue.*` email, which exists precisely to reach
 * somebody who is NOT looking at the admin app (NOTIF-16).
 */
export const RETIRED_EMAIL_TEMPLATES: ReadonlyMap<string, string> = new Map([
  // ── Staff ──────────────────────────────────────────────────────────
  // The single biggest sender on the estate. Staff have had both an
  // inbox and a leads page for months.
  ['staff.invite_lead.email', 'staff.invite_lead'],

  // ── Seller: the order lifecycle (the NOTIF-4 fan-out table) ────────
  ['order.confirmed.seller.email', 'order.confirmed.seller'],
  ['seller.order_dispatched.email', 'seller.order_dispatched'],
  ['seller.order_delivered.email', 'seller.order_delivered'],
  ['seller.order_delivery_failed.email', 'seller.order_delivery_failed'],
  ['seller.order_awaiting_decision.email', 'seller.order_awaiting_decision'],
  // The two RETURN notices (owner, 2026-09-20, on the volume figures).
  // At ~30,000 orders a month and a 15–25% return rate these two alone
  // are roughly 9,000 emails a month — about nine tenths of what was
  // left — and they are the same argument as `order_delivery_failed`
  // above: the seller has an inbox and the parcel is already in it.
  ['shipment.rto_initiated.seller.email', 'shipment.rto_initiated.seller'],
  ['seller.order_rto_received.email', 'seller.order_rto_received'],

  // ── Seller: the standalone senders ─────────────────────────────────
  ['seller.order_needs_attention.email', 'seller.order_needs_attention'],
  ['seller.stock_low_alert.email', 'seller.stock_low_alert'],
  ['seller.goods_receipt_discrepancy.email', 'seller.goods_receipt_discrepancy'],
  ['seller.invoice.delivered.email', 'seller.invoice.delivered'],
  ['seller.topup_submitted.email', 'seller.topup_submitted'],

  // ── Seller: tickets (TKT-3) ────────────────────────────────────────
  // Named for the EVENT, not the recipient, so none of these three is
  // its own template code minus `.email`.
  ['seller.ticket_opened.email', 'ticket.opened_for_you'],
  ['seller.ticket_reply.email', 'ticket.reply'],
  ['seller.ticket_resolved.email', 'ticket.resolved'],

  // ── Reseller store ─────────────────────────────────────────────────
  // CLAUDE.md's "Store actions" paragraph justified these with "the
  // store hears by EMAIL only (no inbox)" — a reason that expired on
  // 2026-09-19 when the store inbox landed.
  ['store.action_approved.email', 'store.action_approved'],
  ['store.action_rejected.email', 'store.action_rejected'],
  ['store.address_change_approved.email', 'store.address_change_approved'],
  ['store.address_change_rejected.email', 'store.address_change_rejected'],
  ['store.request_approved.email', 'store.request_approved'],
  ['store.request_rejected.email', 'store.request_rejected'],
  ['store.request_expired.email', 'store.request_expired'],
  ['store.order_changed_by_seller.email', 'store.order_changed_by_seller'],
  ['store.customer_changed_by_seller.email', 'store.customer_changed_by_seller'],
]);

/** Has this template's EMAIL leg been retired in favour of the inbox? */
export function emailRetired(templateCode: string): boolean {
  return RETIRED_EMAIL_TEMPLATES.has(templateCode);
}
