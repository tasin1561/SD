import {
  ActorType,
  NotificationCategory,
  NotificationChannel,
  Prisma,
  SellerNotificationCategory,
  TicketStatus,
  TicketType,
} from '@skydrop/db';
import { TicketNotifier } from '../../src/modules/ticket/services/ticket-notifier.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import type { NotificationLedgerService } from '../../src/modules/notifications/services/notification-ledger.service';
import type { SellerNotificationPreferenceResolver } from '../../src/modules/seller-notification-preference/services/seller-notification-preference-resolver.service';
import type { EnvService } from '../../src/config/env.service';

type AnyArgs = Record<string, unknown>;

function eventRow(over: Partial<AnyArgs> = {}, ticketOver: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: 'ev-1',
    fromStatus: null,
    toStatus: TicketStatus.OPEN,
    note: 'Ticket opened',
    actorType: ActorType.SYSTEM,
    ...over,
    ticket: {
      id: 'tk-1',
      ticketNumber: 'TK-2026-000004',
      ticketType: TicketType.RECEIPT_SHORTFALL,
      subject: 'CN-2026-08-000003: 2 short at DAC-01',
      description: 'Our opening message',
      resolutionAmountInr: null,
      sellerId: 'seller-1',
      orderId: null,
      seller: { companyName: 'Menev Store', email: 'menev@example.test' },
      ...ticketOver,
    },
  };
}

function make(opts: {
  rows?: Array<AnyArgs | null>;
  pref?: { email: boolean; inApp: boolean; emailDelayMs: number };
  dispatchThrows?: boolean;
}) {
  const rows = [...(opts.rows ?? [eventRow()])];
  const findUnique = jest.fn(async () => (rows.length > 1 ? rows.shift() : rows[0]) ?? null);
  const prisma = { client: { ticketEvent: { findUnique } } } as unknown as PrismaService;
  const dispatch = jest.fn(async () => {
    if (opts.dispatchThrows) throw new Error('dispatch down');
    return { groupId: 'g', recipients: 1, delivered: 1, skipped: 0, failures: 0 };
  });
  const enqueue = jest.fn(async () => ({ kind: 'ENQUEUED', notificationLogId: 'nl-1' }));
  const resolve = jest.fn(async () => opts.pref ?? { email: true, inApp: true, emailDelayMs: 0 });
  const svc = new TicketNotifier(
    prisma,
    { dispatch } as unknown as NotificationDispatchService,
    { enqueue } as unknown as NotificationLedgerService,
    { resolve } as unknown as SellerNotificationPreferenceResolver,
    { sellerAppUrl: 'https://app.test' } as unknown as EnvService,
  );
  svc.commitWaitsMs = [0, 0, 0];
  return { svc, findUnique, dispatch, enqueue, resolve };
}

describe('TicketNotifier', () => {
  it('a ticket we opened reaches the seller in-app AND the company by email', async () => {
    const { svc, dispatch, enqueue, resolve } = make({});
    await svc.run('ev-1');

    expect(resolve).toHaveBeenCalledWith({
      sellerId: 'seller-1',
      category: SellerNotificationCategory.STOCK_ALERTS,
      notificationCategory: NotificationCategory.OPERATIONAL,
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'ticket.opened_for_you',
        category: NotificationCategory.OPERATIONAL,
        channels: [NotificationChannel.IN_APP],
        audience: [{ kind: 'SELLER_PERMISSION', sellerId: 'seller-1', permission: 'tickets.view' }],
        eventId: 'ticket:ev-1:inapp',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'ticket:ev-1',
        channel: NotificationChannel.EMAIL,
        templateCode: 'seller.ticket_opened.email',
        toEmail: 'menev@example.test',
        variables: expect.objectContaining({
          ticket_number: 'TK-2026-000004',
          message: 'Our opening message',
          ticket_url: 'https://app.test/tickets/tk-1',
        }),
      }),
    );
  });

  it("a seller's new ticket reaches staff by permission and emails nobody", async () => {
    const { svc, dispatch, enqueue, resolve } = make({
      rows: [eventRow({ actorType: ActorType.SELLER })],
    });
    await svc.run('ev-1');
    expect(resolve).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'ticket.seller_opened',
        audience: [{ kind: 'STAFF_PERMISSION', permission: 'tickets.view' }],
        eventId: 'ticket:ev-1:staff',
      }),
    );
  });

  it('the company switching the email off leaves the inbox line alone (NOTIF-15)', async () => {
    const { svc, dispatch, enqueue } = make({
      pref: { email: false, inApp: true, emailDelayMs: 0 },
    });
    await svc.run('ev-1');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('quiet hours hold the email send, not the record', async () => {
    const { svc, enqueue } = make({ pref: { email: true, inApp: false, emailDelayMs: 60_000 } });
    await svc.run('ev-1');
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sendDelayMs: 60_000 }));
  });

  it('a failed in-app leg does not cost the seller the email', async () => {
    const { svc, enqueue } = make({ dispatchThrows: true });
    await svc.run('ev-1');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('waits for the event to be committed, and sends nothing for one that never is', async () => {
    // Inside the RTO inspection's transaction the event is not visible
    // yet; the second read sees it.
    const later = make({ rows: [null, eventRow()] });
    await later.svc.run('ev-1');
    expect(later.findUnique).toHaveBeenCalledTimes(2);
    expect(later.dispatch).toHaveBeenCalledTimes(1);

    // A rolled-back write never appears.
    const never = make({ rows: [null] });
    await never.svc.run('ev-1');
    expect(never.findUnique).toHaveBeenCalledTimes(3);
    expect(never.dispatch).not.toHaveBeenCalled();
    expect(never.enqueue).not.toHaveBeenCalled();
  });

  it('a refund resolution carries the amount to the seller', async () => {
    const { svc, dispatch, enqueue } = make({
      rows: [
        eventRow(
          {
            fromStatus: TicketStatus.OPEN,
            toStatus: TicketStatus.RESOLVED_REFUND,
            note: null,
            actorType: ActorType.STAFF,
          },
          { resolutionAmountInr: new Prisma.Decimal('640') },
        ),
      ],
    });
    await svc.run('ev-1');
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'ticket.resolved',
        title: 'Ticket TK-2026-000004 closed — ₹640.00 refunded to your wallet',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: 'seller.ticket_resolved.email' }),
    );
  });

  it('afterEvent never throws, and drainInFlight waits for the work', async () => {
    const { svc, findUnique, dispatch } = make({});
    findUnique.mockRejectedValueOnce(new Error('db down'));
    expect(() => svc.afterEvent('ev-bad')).not.toThrow();
    svc.afterEvent('ev-1');
    await svc.drainInFlight();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
