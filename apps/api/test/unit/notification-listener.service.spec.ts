import {
  ActorType,
  NotificationChannel,
  NotificationRecipientType,
  OrderStatus,
} from '@skydrop/db';
import { NotificationListener } from '../../src/modules/notifications/services/notification-listener.service';
import { NotificationEventMappingService } from '../../src/modules/notifications/services/notification-event-mapping.service';
import type { OrderLifecycleEvent } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { OrderLifecycleEventBus } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';
import type { NotificationLedgerService } from '../../src/modules/notifications/services/notification-ledger.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { makeTestEnv } from '../helpers/env';

const REAL_MAPPING = new NotificationEventMappingService();

interface OrderFixture {
  id: string;
  orderNumber: string;
  sellerId: string;
  sellerEmail: string;
  companyName: string;
  customerId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientCity: string;
  recipientStateProvince: string;
  codAmountInr: { toFixed: (n: number) => string } | null;
  cancellationReason: string | null;
  expectedDeliveryAt: Date | null;
  shipmentId: string | null;
  awbNumber: string | null;
  courierName: string | null;
  deliveredAt: Date | null;
  /** M13 CP2.A.1 — latest delivery_attempt on the live shipment.
   *  null when no attempts have been recorded. */
  deliveryAttempt?: { failureReason: string | null; failureNotes: string | null } | null;
}

function makeSut(fixture: OrderFixture | null) {
  const prisma = {
    client: {
      order: {
        findFirst: jest.fn(async () => {
          if (!fixture) return null;
          return {
            id: fixture.id,
            orderNumber: fixture.orderNumber,
            sellerId: fixture.sellerId,
            customerId: fixture.customerId,
            recipientName: fixture.recipientName,
            recipientEmail: fixture.recipientEmail,
            recipientCity: fixture.recipientCity,
            recipientStateProvince: fixture.recipientStateProvince,
            codAmountInr: fixture.codAmountInr,
            cancellationReason: fixture.cancellationReason,
            expectedDeliveryAt: fixture.expectedDeliveryAt,
            seller: {
              email: fixture.sellerEmail,
              companyName: fixture.companyName,
            },
            orderShipments: fixture.shipmentId
              ? [
                  {
                    shipment: {
                      id: fixture.shipmentId,
                      awbNumber: fixture.awbNumber,
                      deliveredAt: fixture.deliveredAt,
                      courier: fixture.courierName
                        ? { name: fixture.courierName, code: 'delhivery' }
                        : null,
                      deliveryAttempts: fixture.deliveryAttempt ? [fixture.deliveryAttempt] : [],
                    },
                  },
                ]
              : [],
          };
        }),
      },
    },
  } as unknown as PrismaService;

  const enqueueCalls: Array<Parameters<NotificationLedgerService['enqueue']>[0]> = [];
  const ledger = {
    enqueue: jest.fn(async (input: Parameters<NotificationLedgerService['enqueue']>[0]) => {
      enqueueCalls.push(input);
      return { kind: 'ENQUEUED', notificationLogId: `log-${enqueueCalls.length}` };
    }),
  } as unknown as NotificationLedgerService;

  const bus = {
    subscribe: jest.fn(),
  } as unknown as OrderLifecycleEventBus;

  const env = makeTestEnv();

  return {
    listener: new NotificationListener(bus, REAL_MAPPING, ledger, prisma, env),
    enqueueCalls,
    ledger,
    env,
  };
}

function lifecycleEvent(to: OrderStatus, statusEventId = 'evt-1'): OrderLifecycleEvent {
  return {
    orderId: 'order-1',
    sellerId: 'seller-1',
    from: OrderStatus.PENDING_DISPATCH,
    to,
    statusEventId,
    actorType: ActorType.SYSTEM,
    actorId: null,
    occurredAt: new Date('2026-05-26T12:00:00Z'),
  };
}

const ORDER_BASE: OrderFixture = {
  id: 'order-1',
  orderNumber: 'SD-2026-01-000001',
  sellerId: 'seller-1',
  sellerEmail: 'seller@acme.in',
  companyName: 'Acme Co',
  customerId: 'customer-1',
  recipientName: 'Pooja',
  recipientEmail: 'pooja@example.in',
  recipientCity: 'Mumbai',
  recipientStateProvince: 'Maharashtra',
  codAmountInr: { toFixed: (n: number) => (999.5).toFixed(n) } as OrderFixture['codAmountInr'],
  cancellationReason: null,
  expectedDeliveryAt: new Date('2026-05-30T00:00:00Z'),
  shipmentId: 'shipment-1',
  awbNumber: 'DLV12345',
  courierName: 'Delhivery',
  deliveredAt: null,
};

describe('NotificationListener', () => {
  describe('DISPATCHED — both targets fan out + tracking URL composed', () => {
    it('enqueues seller + customer rows with the M10 tracking URL in variables', async () => {
      const { listener, enqueueCalls, env } = makeSut(ORDER_BASE);

      await listener.handle(lifecycleEvent(OrderStatus.DISPATCHED, 'evt-disp-1'));

      expect(enqueueCalls).toHaveLength(2);
      const sellerCall = enqueueCalls.find(
        (c) => c.recipientType === NotificationRecipientType.SELLER,
      );
      const customerCall = enqueueCalls.find(
        (c) => c.recipientType === NotificationRecipientType.CUSTOMER,
      );
      expect(sellerCall).toBeDefined();
      expect(customerCall).toBeDefined();

      // Both calls share the SAME eventId (= order_status:<statusEventId>);
      // the dedup tuple distinguishes them by recipientType + templateCode.
      expect(sellerCall?.eventId).toBe('order_status:evt-disp-1');
      expect(customerCall?.eventId).toBe('order_status:evt-disp-1');
      expect(sellerCall?.templateCode).toBe('seller.order_dispatched.email');
      expect(customerCall?.templateCode).toBe('customer.order_dispatched.email');

      // Seller: live record email; recipientId = sellerId.
      expect(sellerCall?.toEmail).toBe('seller@acme.in');
      expect(sellerCall?.recipientId).toBe('seller-1');

      // Customer: ORD-6 recipientEmail snapshot; recipientId = customerId.
      expect(customerCall?.toEmail).toBe('pooja@example.in');
      expect(customerCall?.recipientId).toBe('customer-1');

      // M10 tracking URL: `${PUBLIC_TRACKING_URL}/${awb}`.
      const expectedUrl = `${env.publicTrackingUrl}/${encodeURIComponent('DLV12345')}`;
      expect(customerCall?.variables.tracking_url).toBe(expectedUrl);
      expect(sellerCall?.variables.awb_number).toBe('DLV12345');
      expect(sellerCall?.variables.courier_name).toBe('Delhivery');
    });

    it('triggerEvent encodes the edge', async () => {
      const { listener, enqueueCalls } = makeSut(ORDER_BASE);
      const e = lifecycleEvent(OrderStatus.DISPATCHED, 'evt-3');
      await listener.handle(e);
      expect(enqueueCalls[0]?.triggerEvent).toBe('order_status:PENDING_DISPATCH_to_DISPATCHED');
    });
  });

  describe('NOTIF-8 — customer with no recipientEmail still fans out (ledger SKIPS internally)', () => {
    it('customer enqueue is called with toEmail null; seller enqueue unaffected', async () => {
      const { listener, enqueueCalls } = makeSut({
        ...ORDER_BASE,
        recipientEmail: null,
      });

      await listener.handle(lifecycleEvent(OrderStatus.DELIVERED, 'evt-delv-1'));

      expect(enqueueCalls).toHaveLength(2);
      const sellerCall = enqueueCalls.find(
        (c) => c.recipientType === NotificationRecipientType.SELLER,
      );
      const customerCall = enqueueCalls.find(
        (c) => c.recipientType === NotificationRecipientType.CUSTOMER,
      );
      expect(sellerCall?.toEmail).toBe('seller@acme.in');
      expect(customerCall?.toEmail).toBeNull();
      // Listener still emits to ledger — ledger handles the SKIPPED
      // branch (no enqueue + SKIPPED row).
    });
  });

  describe('customer with no Customer row uses orderId as recipientId surrogate', () => {
    it('falls back to orderId so the dedup tuple stays concrete', async () => {
      const { listener, enqueueCalls } = makeSut({
        ...ORDER_BASE,
        customerId: null,
      });

      await listener.handle(lifecycleEvent(OrderStatus.DELIVERED, 'evt-delv-2'));
      const customerCall = enqueueCalls.find(
        (c) => c.recipientType === NotificationRecipientType.CUSTOMER,
      );
      expect(customerCall).toBeDefined();
      // orderId as surrogate — keeps dedup tuple concrete (PG NULL-
      // distinct semantics would otherwise let two NULL rows BOTH
      // succeed → double send).
      expect(customerCall?.recipientId).toBe('order-1');
    });
  });

  describe('NOTIF-3 independence — one target failure does not abort the loop', () => {
    it('seller throw does not block customer enqueue', async () => {
      const { listener, enqueueCalls, ledger } = makeSut(ORDER_BASE);
      // Make seller enqueue throw; customer enqueue should still happen.
      (ledger.enqueue as jest.Mock).mockImplementationOnce(async () => {
        throw new Error('seller-side kaboom');
      });

      await listener.handle(lifecycleEvent(OrderStatus.DISPATCHED, 'evt-isol-1'));

      // 1 thrown + 1 successful → 2 invocations total; the loop never
      // aborted (NOTIF-3 independence).
      expect((ledger.enqueue as jest.Mock).mock.calls).toHaveLength(2);
      expect(enqueueCalls).toHaveLength(1); // only the customer call landed in store
      expect(enqueueCalls[0]?.recipientType).toBe(NotificationRecipientType.CUSTOMER);
    });
  });

  describe('mapping → [] (PENDING_MANUAL_PLACEMENT / pre-confirm) — no fan-out', () => {
    it('PENDING_MANUAL_PLACEMENT → zero enqueues', async () => {
      const { listener, enqueueCalls } = makeSut(ORDER_BASE);
      await listener.handle(lifecycleEvent(OrderStatus.PENDING_MANUAL_PLACEMENT));
      expect(enqueueCalls).toHaveLength(0);
    });

    it('PENDING_CONFIRMATION → zero enqueues', async () => {
      const { listener, enqueueCalls } = makeSut(ORDER_BASE);
      await listener.handle(lifecycleEvent(OrderStatus.PENDING_CONFIRMATION));
      expect(enqueueCalls).toHaveLength(0);
    });
  });

  describe('order vanished between emit + load — silent skip (race / soft-delete)', () => {
    it('handle() returns normally when order not found', async () => {
      const { listener, enqueueCalls } = makeSut(null);
      await expect(
        listener.handle(lifecycleEvent(OrderStatus.DISPATCHED)),
      ).resolves.toBeUndefined();
      expect(enqueueCalls).toHaveLength(0);
    });
  });

  describe('OUT_FOR_DELIVERY — customer-only fan-out per Q5', () => {
    it('exactly one enqueue, CUSTOMER recipient', async () => {
      const { listener, enqueueCalls } = makeSut(ORDER_BASE);
      await listener.handle(lifecycleEvent(OrderStatus.OUT_FOR_DELIVERY));
      expect(enqueueCalls).toHaveLength(1);
      expect(enqueueCalls[0]?.recipientType).toBe(NotificationRecipientType.CUSTOMER);
      expect(enqueueCalls[0]?.channel).toBe(NotificationChannel.EMAIL);
    });
  });

  // ── M13 CP2.A.1 — closes the M11 ndr_reason phase-1a-debt entry ─────
  describe('DELIVERY_FAILED — ndr_reason surfaces from latest delivery_attempt', () => {
    it('humanizes the failureReason enum (CUSTOMER_PHONE_UNREACHABLE → "Customer Phone Unreachable")', async () => {
      const { listener, enqueueCalls } = makeSut({
        ...ORDER_BASE,
        deliveryAttempt: {
          failureReason: 'CUSTOMER_PHONE_UNREACHABLE',
          failureNotes: null,
        },
      });
      await listener.handle(lifecycleEvent(OrderStatus.DELIVERY_FAILED));
      // Q5 maps DELIVERY_FAILED → seller + customer; both rows carry
      // the same templateData (ndr_reason in particular).
      expect(enqueueCalls.length).toBeGreaterThan(0);
      for (const call of enqueueCalls) {
        expect(call.variables.ndr_reason).toBe('Customer Phone Unreachable');
      }
    });

    it('falls back to failureNotes when failureReason is null', async () => {
      const { listener, enqueueCalls } = makeSut({
        ...ORDER_BASE,
        deliveryAttempt: {
          failureReason: null,
          failureNotes: '  Customer requested redelivery tomorrow  ',
        },
      });
      await listener.handle(lifecycleEvent(OrderStatus.DELIVERY_FAILED));
      for (const call of enqueueCalls) {
        // trimmed, raw notes — operator authored
        expect(call.variables.ndr_reason).toBe('Customer requested redelivery tomorrow');
      }
    });

    it('empty string when no delivery_attempt is recorded (generic NDR copy)', async () => {
      const { listener, enqueueCalls } = makeSut(ORDER_BASE);
      await listener.handle(lifecycleEvent(OrderStatus.DELIVERY_FAILED));
      for (const call of enqueueCalls) {
        expect(call.variables.ndr_reason).toBe('');
      }
    });
  });
});
