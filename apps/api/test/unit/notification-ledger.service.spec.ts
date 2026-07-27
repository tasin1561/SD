import {
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  Prisma,
} from '@skydrop/db';
import { NotificationLedgerService } from '../../src/modules/notifications/services/notification-ledger.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { EmailQueue } from '../../src/modules/email/queue/email.queue';
import type { EmailDispatchInput } from '../../src/modules/email/email.types';

type CreatedRow = {
  id: string;
  data: {
    status: NotificationStatus;
    eventId: string;
    recipientType: NotificationRecipientType;
    recipientId: string;
    channel: NotificationChannel;
    templateCode: string;
    toEmail: string | null;
  };
};

interface FakeStore {
  rows: CreatedRow[];
}

function makeSut(opts: { simulateUVOnSecondCreate?: boolean } = {}) {
  const store: FakeStore = { rows: [] };
  let nextId = 0;
  let createCallCount = 0;

  const prisma = {
    client: {
      notificationLog: {
        create: jest.fn(
          async ({ data, select }: { data: CreatedRow['data']; select?: unknown }) => {
            createCallCount += 1;
            // Composite-key partial-unique simulation: a 2nd create on
            // the same (eventId, recipientType, recipientId, channel,
            // templateCode) tuple throws P2002 — exactly the partial-
            // unique violation the production migration declares.
            if (opts.simulateUVOnSecondCreate && createCallCount >= 2) {
              const err = new Prisma.PrismaClientKnownRequestError('partial unique violation', {
                code: 'P2002',
                clientVersion: 'test',
                meta: { target: 'notification_logs_event_dedup_uq' },
              });
              throw err;
            }
            // The real partial-unique would also reject any composite-
            // key dup; mimic that for explicit dup-detect tests too.
            const existing = store.rows.find(
              (r) =>
                r.data.eventId === data.eventId &&
                r.data.recipientType === data.recipientType &&
                r.data.recipientId === data.recipientId &&
                r.data.channel === data.channel &&
                r.data.templateCode === data.templateCode,
            );
            if (existing) {
              const err = new Prisma.PrismaClientKnownRequestError('partial unique violation', {
                code: 'P2002',
                clientVersion: 'test',
                meta: { target: 'notification_logs_event_dedup_uq' },
              });
              throw err;
            }
            nextId += 1;
            const row: CreatedRow = { id: `log-${nextId}`, data };
            store.rows.push(row);
            // The select shape is `{ id: true }` — return just the id.
            void select;
            return { id: row.id };
          },
        ),
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const row = store.rows.find(
            (r) =>
              r.data.eventId === where['eventId'] &&
              r.data.recipientType === where['recipientType'] &&
              r.data.recipientId === where['recipientId'] &&
              r.data.channel === where['channel'] &&
              r.data.templateCode === where['templateCode'],
          );
          return row ? { id: row.id } : null;
        }),
      },
    },
  } as unknown as PrismaService;

  const enqueued: EmailDispatchInput[] = [];
  const emailQueue = {
    enqueue: jest.fn(async (input: EmailDispatchInput) => {
      enqueued.push(input);
      return `bullmq-job-${enqueued.length}`;
    }),
  } as unknown as EmailQueue;

  return {
    svc: new NotificationLedgerService(prisma, emailQueue),
    store,
    enqueued,
  };
}

const BASE_INPUT = {
  eventId: 'order_status:order-1:CONFIRMED:DISPATCHED',
  recipientType: NotificationRecipientType.SELLER,
  recipientId: 'seller-uuid-1',
  channel: NotificationChannel.EMAIL,
  templateCode: 'seller.order_dispatched.email',
  locale: 'en',
  toEmail: 'seller@example.com',
  variables: { order_number: 'SD-2026-01-000001' },
  orderId: 'order-1',
  triggerEvent: 'order_status:DISPATCHED',
} as const;

describe('NotificationLedgerService', () => {
  describe('happy path — INSERT pending row + enqueue', () => {
    it('writes a QUEUED row with eventId and enqueues onto EmailQueue', async () => {
      const { svc, store, enqueued } = makeSut();

      const res = await svc.enqueue(BASE_INPUT);

      expect(res.kind).toBe('ENQUEUED');
      if (res.kind !== 'ENQUEUED') throw new Error('narrow');
      expect(res.notificationLogId).toBe('log-1');

      // Row written with the dedup-anchor columns + QUEUED status.
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]?.data.status).toBe(NotificationStatus.QUEUED);
      expect(store.rows[0]?.data.eventId).toBe(BASE_INPUT.eventId);
      expect(store.rows[0]?.data.templateCode).toBe(BASE_INPUT.templateCode);

      // Enqueued with existingNotificationLogId so the worker UPDATEs
      // our pre-created row instead of creating a fresh one (NOTIF-2
      // store-then-send model).
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]?.existingNotificationLogId).toBe('log-1');
      expect(enqueued[0]?.templateCode).toBe(BASE_INPUT.templateCode);
      expect(enqueued[0]?.recipient.email).toBe(BASE_INPUT.toEmail);
      expect(enqueued[0]?.language).toBe('en');
    });
  });

  describe('NOTIF-3 fan-out independence — composite-key dedup catches re-emits', () => {
    it('second enqueue() with the same composite tuple returns DEDUPED, no second enqueue', async () => {
      const { svc, store, enqueued } = makeSut();

      const first = await svc.enqueue(BASE_INPUT);
      expect(first.kind).toBe('ENQUEUED');

      const second = await svc.enqueue(BASE_INPUT);
      expect(second.kind).toBe('DEDUPED');
      if (second.kind !== 'DEDUPED') throw new Error('narrow');
      // Both responses resolve to the SAME ledger row id.
      if (first.kind !== 'ENQUEUED') throw new Error('narrow');
      expect(second.notificationLogId).toBe(first.notificationLogId);

      // No second row, no second BullMQ enqueue (the gate fires
      // BEFORE the queue is touched).
      expect(store.rows).toHaveLength(1);
      expect(enqueued).toHaveLength(1);
    });

    it('different recipientType for the same eventId IS a distinct fan-out target', async () => {
      // Mirrors how the listener calls enqueue() twice for one event
      // (DELIVERED → seller row + customer row): same eventId, but
      // different (recipientType, recipientId, templateCode) → two
      // independent ledger rows + two independent enqueues.
      const { svc, store, enqueued } = makeSut();

      const sellerRes = await svc.enqueue({
        ...BASE_INPUT,
        recipientType: NotificationRecipientType.SELLER,
        recipientId: 'seller-1',
        templateCode: 'seller.order_dispatched.email',
      });
      const customerRes = await svc.enqueue({
        ...BASE_INPUT,
        recipientType: NotificationRecipientType.CUSTOMER,
        recipientId: 'customer-1',
        templateCode: 'customer.order_dispatched.email',
        toEmail: 'cust@x.io',
      });

      expect(sellerRes.kind).toBe('ENQUEUED');
      expect(customerRes.kind).toBe('ENQUEUED');
      expect(store.rows).toHaveLength(2);
      expect(enqueued).toHaveLength(2);
      // The two rows have the SAME eventId — the gate distinguishes
      // them by (recipientType, recipientId, templateCode).
      expect(store.rows[0]?.data.eventId).toBe(store.rows[1]?.data.eventId);
    });
  });

  describe('NOTIF-8 SKIPPED — no resolvable email address', () => {
    it('writes a SKIPPED row and does NOT enqueue (customer with no email)', async () => {
      const { svc, store, enqueued } = makeSut();

      const res = await svc.enqueue({
        ...BASE_INPUT,
        recipientType: NotificationRecipientType.CUSTOMER,
        recipientId: 'customer-1',
        templateCode: 'customer.order_dispatched.email',
        toEmail: null,
      });

      expect(res.kind).toBe('SKIPPED');
      if (res.kind !== 'SKIPPED') throw new Error('narrow');
      expect(res.reason).toBe('NO_ADDRESS');

      // Row recorded for forensics in SKIPPED status, NOT FAILED.
      expect(store.rows).toHaveLength(1);
      expect(store.rows[0]?.data.status).toBe(NotificationStatus.SKIPPED);
      expect(store.rows[0]?.data.toEmail).toBeNull();
      expect(store.rows[0]?.data.eventId).toBe(BASE_INPUT.eventId);

      // No BullMQ enqueue (NOTIF-8).
      expect(enqueued).toHaveLength(0);
    });

    it('re-emit of the SAME SKIPPED event returns DEDUPED (the gate consumes the eventId)', async () => {
      const { svc, store, enqueued } = makeSut();
      const input = {
        ...BASE_INPUT,
        recipientType: NotificationRecipientType.CUSTOMER,
        recipientId: 'customer-1',
        templateCode: 'customer.order_dispatched.email',
        toEmail: null,
      };

      const first = await svc.enqueue(input);
      expect(first.kind).toBe('SKIPPED');

      const second = await svc.enqueue(input);
      expect(second.kind).toBe('DEDUPED');
      if (second.kind !== 'DEDUPED') throw new Error('narrow');
      if (first.kind !== 'SKIPPED') throw new Error('narrow');
      expect(second.notificationLogId).toBe(first.notificationLogId);

      // Exactly one SKIPPED row, no enqueue ever.
      expect(store.rows).toHaveLength(1);
      expect(enqueued).toHaveLength(0);
    });
  });

  describe('non-UV errors propagate (defensive — should not silently swallow)', () => {
    it('re-throws when create() raises a non-P2002 error', async () => {
      const prisma = {
        client: {
          notificationLog: {
            create: jest.fn(async () => {
              throw new Error('unexpected db kaboom');
            }),
            findFirst: jest.fn(async () => null),
          },
        },
      } as unknown as PrismaService;
      const emailQueue = { enqueue: jest.fn() } as unknown as EmailQueue;
      const svc = new NotificationLedgerService(prisma, emailQueue);

      await expect(svc.enqueue(BASE_INPUT)).rejects.toThrow(/unexpected db kaboom/);
      expect((emailQueue.enqueue as jest.Mock).mock.calls).toHaveLength(0);
    });
  });
});
