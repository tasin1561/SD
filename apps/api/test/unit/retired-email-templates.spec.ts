import { NotificationSubjectType } from '@skydrop/db';
import {
  RETIRED_EMAIL_TEMPLATES,
  emailRetired,
} from '../../src/common/notifications/retired-email-templates';
import {
  NotificationTopicCatalogService,
  SELLER_TOPICS,
  STAFF_TOPICS,
  STORE_TOPICS,
} from '../../src/modules/notification-audience/services/notification-topic-catalog.service';
import { INVITE_LEAD_TOPIC } from '../../src/modules/invite-lead/services/invite-lead.service';
import { ORDER_NEEDS_ATTENTION_TOPIC } from '../../src/modules/order-attention/services/order-attention.service';
import { STOCK_LOW_ALERT_TOPIC } from '../../src/modules/inventory-shared/stock-alert.service';
import { GOODS_RECEIPT_DISCREPANCY_TOPIC } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import { INVOICE_DELIVERED_TOPIC } from '../../src/modules/invoice/services/invoice.service';
import { TOPUP_SUBMITTED_TOPIC } from '../../src/modules/wallet-topup/services/wallet-topup.service';
import {
  TICKET_OPENED_FOR_YOU_TOPIC,
  TICKET_REPLY_TOPIC,
  TICKET_RESOLVED_TOPIC,
} from '../../src/modules/ticket/services/ticket-notification-plan';

/**
 * RULE ZERO for `RETIRED_EMAIL_TEMPLATES` (owner, 2026-09-20).
 *
 * Dropping an email leg only MOVES a message to another channel if that
 * channel exists. Without one it deletes the message — and it does so
 * silently, because nothing fails when nobody is told. That is the whole
 * failure mode this file exists to make impossible, so every assertion
 * here is some form of "and where did it go?".
 */
describe('RETIRED_EMAIL_TEMPLATES', () => {
  const catalog = new NotificationTopicCatalogService();

  const everyTopic = new Set<string>([
    ...SELLER_TOPICS.map((t) => t.topic),
    ...STAFF_TOPICS.map((t) => t.topic),
    ...STORE_TOPICS.map((t) => t.topic),
  ]);

  it('every retired email names an in-app topic the catalogue actually serves', () => {
    // THE load-bearing test. A code added to the map with a topic nobody
    // serves is a message that now goes nowhere: the email is withheld
    // and the inbox has no line for it, so the only evidence is a
    // recipient who was never told.
    const orphaned = [...RETIRED_EMAIL_TEMPLATES.entries()]
      .filter(([, topic]) => !everyTopic.has(topic))
      .map(([code, topic]) => `${code} -> ${topic}`);
    expect(orphaned).toEqual([]);
  });

  it('a retired topic is one a person can find and silence', () => {
    // The corollary: the topic has to be on the settings page of the
    // subject it is sent to, or the inbox line arrives with no way to
    // turn it off — which is how a bell becomes something people ignore.
    for (const subject of [
      NotificationSubjectType.SELLER_USER,
      NotificationSubjectType.STAFF_USER,
      NotificationSubjectType.STORE_USER,
    ]) {
      for (const t of catalog.forSubject(subject)) {
        expect(typeof t.label).toBe('string');
        expect(t.label).not.toBe('');
      }
    }
    // And every retired destination is served to exactly one subject —
    // a key shared between two would let one identity's mute silence
    // another's.
    for (const topic of RETIRED_EMAIL_TEMPLATES.values()) {
      const owners = [
        SELLER_TOPICS.some((t) => t.topic === topic),
        STAFF_TOPICS.some((t) => t.topic === topic),
        STORE_TOPICS.some((t) => t.topic === topic),
      ].filter(Boolean);
      expect(owners).toHaveLength(1);
    }
  });

  it('every retired code is a real `.email` template code', () => {
    // Cheap, and it catches the likeliest typo: writing the TOPIC into
    // the key column. The gate keys on the template code, so a topic
    // there would match nothing and retire nothing while looking done.
    for (const code of RETIRED_EMAIL_TEMPLATES.keys()) {
      expect(code.endsWith('.email')).toBe(true);
    }
  });

  it('the topic is the code without `.email`, except for the three ticket ones', () => {
    // NOTIF-14's rule, and its only deliberate exceptions — named, so
    // that a FOURTH exception has to be argued for rather than typed.
    const exceptions = new Set([
      'seller.ticket_opened.email',
      'seller.ticket_reply.email',
      'seller.ticket_resolved.email',
    ]);
    for (const [code, topic] of RETIRED_EMAIL_TEMPLATES) {
      if (exceptions.has(code)) continue;
      expect(topic).toBe(code.replace(/\.email$/, ''));
    }
  });

  it('is keyed to the constants the senders actually dispatch on', () => {
    // The six standalone senders had NO in-app leg before this change,
    // so each one's topic is a new constant. Pinning the map to the
    // constant (rather than to a repeated string) is what stops the two
    // drifting: a rename that misses the map would otherwise retire the
    // email and leave the inbox line on a key nobody silences.
    expect(RETIRED_EMAIL_TEMPLATES.get('staff.invite_lead.email')).toBe(INVITE_LEAD_TOPIC);
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.order_needs_attention.email')).toBe(
      ORDER_NEEDS_ATTENTION_TOPIC,
    );
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.stock_low_alert.email')).toBe(STOCK_LOW_ALERT_TOPIC);
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.goods_receipt_discrepancy.email')).toBe(
      GOODS_RECEIPT_DISCREPANCY_TOPIC,
    );
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.invoice.delivered.email')).toBe(
      INVOICE_DELIVERED_TOPIC,
    );
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.topup_submitted.email')).toBe(TOPUP_SUBMITTED_TOPIC);
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.ticket_opened.email')).toBe(
      TICKET_OPENED_FOR_YOU_TOPIC,
    );
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.ticket_reply.email')).toBe(TICKET_REPLY_TOPIC);
    expect(RETIRED_EMAIL_TEMPLATES.get('seller.ticket_resolved.email')).toBe(TICKET_RESOLVED_TOPIC);
  });

  it('leaves the channels that have no inbox behind them alone', () => {
    // The four kinds deliberately excluded, each for a reason that is
    // about the RECIPIENT rather than about the message:
    //
    //   CREDENTIAL  — NOTIF-9 makes email the only channel structurally.
    //                 An invitation has no account to be read from, and
    //                 a password reset you must sign in to read is
    //                 useless.
    //   customer.*  — no customer login in Phase-1A, so no inbox.
    //   marketing.* — the lead is a stranger with no account.
    //   system_issue— NOTIF-16 emails only CRITICAL, precisely so it
    //                 reaches somebody NOT looking at the admin app.
    for (const code of [
      'seller.invitation.email',
      'seller.password_reset.email',
      'seller.password_changed.email',
      'seller.email_verification.email',
      'seller.welcome.email',
      'staff.invitation.email',
      'staff.password_reset.email',
      'staff.password_changed.email',
      'staff.email_verification.email',
      'staff.welcome.email',
      'store.invitation.email',
      'store.password_reset.email',
      'store.password_changed.email',
      'store.email_verification.email',
      'customer.order_confirmed.email',
      'customer.order_dispatched.email',
      'customer.order_delivered.email',
      'customer.order_delivery_failed.email',
      'customer.order_out_for_delivery.email',
      'customer.order_cancelled.email',
      'marketing.invite_lead_ack.email',
      'system.alert.email',
    ]) {
      expect(emailRetired(code)).toBe(false);
    }
  });

  it('leaves the seller notices the owner did not name', () => {
    // Listed so that extending the retirement is a deliberate edit to
    // this array and the map together, rather than something that
    // happens by accident to a message somebody still relies on.
    for (const code of [
      'seller.order_cancelled.email',
      'seller.topup_accepted.email',
      'seller.topup_rejected.email',
      'seller.account_suspended.email',
      'seller.account_reapproved.email',
      'seller.consignment_arrived.email',
      'seller.consignment_bd_received.email',
      'seller.consignment_dispatched.email',
      'seller.consignment_cancelled.email',
      'seller.goods_receipt_completed.email',
      'seller.stock_adjustment_executed.email',
      // The store's terms and its ticket copies keep both legs.
      'store.terms_published.email',
      'store.ticket_reply.email',
      'store.ticket_resolved.email',
      // God mode changing a store's money keeps both legs: neither the
      // store nor the seller made that change.
      'store.order_changed_by_admin.email',
    ]) {
      expect(emailRetired(code)).toBe(false);
    }
  });
});
