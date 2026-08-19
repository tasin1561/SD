import { ConsignmentService } from '../../src/modules/consignment/services/consignment.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ConsignmentEventService } from '../../src/modules/consignment-core/services/consignment-event.service';
import type { ConsignmentNumberingService } from '../../src/modules/consignment-core/services/consignment-numbering.service';
import type { ConsignmentStatusService } from '../../src/modules/consignment-core/services/consignment-status.service';
import type { GoodsReceiptService } from '../../src/modules/inventory-receipt/services/goods-receipt.service';
import type { WarehouseResolverService } from '../../src/modules/inventory-shared/warehouse-resolver.service';

type Any = any;

const CTX = { ipAddress: '1.1.1.1', userAgent: 'jest', requestId: 'req-1' };

function svcWith(row: Any) {
  const updates: Any[] = [];
  const client: Any = {
    consignment: {
      findFirst: async () => row,
      update: async (args: Any) => {
        updates.push(args.data);
        return args.data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  const noop = {} as unknown;
  const svc = new ConsignmentService(
    { client } as unknown as PrismaService,
    { log: async () => undefined } as unknown as AuditLogService,
    noop as ConsignmentNumberingService,
    { append: async () => ({ id: 'ce1' }) } as unknown as ConsignmentEventService,
    { recompute: async () => 'PENDING' } as unknown as ConsignmentStatusService,
    noop as GoodsReceiptService,
    noop as WarehouseResolverService,
  );
  return { svc, updates };
}

const leg = (over: Any = {}) => ({
  id: 'gr1',
  leg: 'BD_INTAKE',
  status: 'COMPLETED',
  dispatchedAt: null,
  ...over,
});

const consignment = (over: Any = {}) => ({
  id: 'cn1',
  sellerId: 's1',
  consignmentNumber: 'CN-2026-08-000001',
  route: 'VIA_BD',
  status: 'AT_BD',
  labellingSite: 'NONE',
  labelsPrintedAt: null,
  cancelledAt: null,
  receipts: [leg()],
  ...over,
});

describe('the cancel window CLOSES at dispatch', () => {
  it('allows cancelling while the goods are still in Bangladesh', async () => {
    const { svc } = svcWith(consignment());
    await expect(svc.assertCancellable(consignment() as Any)).resolves.toBeUndefined();
    void svc;
  });

  it('refuses once ANY leg has left for India', async () => {
    // Not a policy preference. Cancelling mid-air would force answers to
    // who eats the freight, where TRANSIT stock goes back to, and what
    // happens when a parcel lands against a consignment that no longer
    // exists. Refusing here makes all three unreachable.
    const { svc } = svcWith(consignment());
    await expect(
      svc.assertCancellable(
        consignment({
          receipts: [leg(), leg({ id: 'gr2', leg: 'IN_FINAL', dispatchedAt: new Date() })],
        }) as Any,
      ),
    ).rejects.toMatchObject({ response: { code: 'CONSIGNMENT_ALREADY_DISPATCHED' } });
  });

  it('refuses once an India leg has been counted', async () => {
    const { svc } = svcWith(consignment());
    await expect(
      svc.assertCancellable(
        consignment({
          receipts: [leg({ id: 'gr2', leg: 'IN_FINAL', status: 'COMPLETED' })],
        }) as Any,
      ),
    ).rejects.toMatchObject({ response: { code: 'CONSIGNMENT_ALREADY_ARRIVED' } });
  });

  it('refuses a second cancel', async () => {
    const { svc } = svcWith(consignment());
    await expect(
      svc.assertCancellable(consignment({ status: 'CANCELLED' }) as Any),
    ).rejects.toMatchObject({ response: { code: 'CONSIGNMENT_ALREADY_CANCELLED' } });
  });
});

describe('the labelling station is ONE place, and locks on first print', () => {
  it('can be set freely before anything is printed', async () => {
    const { svc, updates } = svcWith(consignment());
    await svc.setLabellingSite('staff1', 'cn1', 'BD' as Any, CTX);
    expect(updates).toEqual([{ labellingSite: 'BD' }]);
  });

  it('is LOCKED once labels have been printed', async () => {
    // A consignment half-labelled in Dhaka and half in Bangalore cannot
    // be told apart without opening every carton.
    const { svc } = svcWith(consignment({ labellingSite: 'BD', labelsPrintedAt: new Date() }));
    await expect(svc.setLabellingSite('staff1', 'cn1', 'IN' as Any, CTX)).rejects.toMatchObject({
      response: { code: 'LABELLING_SITE_LOCKED' },
    });
  });

  it('refuses Bangladesh for a consignment that never goes there', async () => {
    const { svc } = svcWith(consignment({ route: 'DIRECT_IN' }));
    await expect(svc.setLabellingSite('staff1', 'cn1', 'BD' as Any, CTX)).rejects.toMatchObject({
      response: { code: 'LABELLING_SITE_UNREACHABLE' },
    });
  });

  it('allows India on a direct consignment', async () => {
    const { svc, updates } = svcWith(consignment({ route: 'DIRECT_IN' }));
    await svc.setLabellingSite('staff1', 'cn1', 'IN' as Any, CTX);
    expect(updates).toEqual([{ labellingSite: 'IN' }]);
  });
});
