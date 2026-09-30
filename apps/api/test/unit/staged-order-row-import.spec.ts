import { OrderSource, OrderStatus, StagedRowStatus } from '@skydrop/db';
import { StagedOrderRowService } from '../../src/modules/order-csv-import/services/staged-order-row.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { OrderService } from '../../src/modules/order/services/order.service';

type AnyArgs = any;

/** A row that is complete — every value the validator asks for. */
const GOOD_ROW = {
  externalRef: 'RSH-2026-0505',
  productSku: 'RSH-JAMDANI-IVORY',
  quantity: '1',
  customerName: 'Kavya Reddy',
  customerPhone: '+919845011068',
  addressLine1: '307 Whitefield Main Road, Hoodi',
  addressLine2: 'The lane behind the Hoodi circle bus stop',
  city: 'Bengaluru',
  state: 'Karnataka',
  pinCode: '560066',
  codAmount: '2400',
};

function makeService(over: AnyArgs = {}) {
  // Declared with rest ARGS, not `()`. `jest.fn(async () => …)` infers
  // its call tuple as `[]`, so reading `mock.calls[0]![4]` below — the
  // options argument, which is the whole point of these two tests — is
  // `TS2493: tuple of length 0 has no element at index 4`. Typecheck-only;
  // the assertions themselves were always right.
  const create = jest.fn(async (..._args: AnyArgs[]) => ({ id: 'order-1' }));
  const prisma = {
    client: {
      stagedOrderRow: {
        findFirst: jest.fn(async () => ({
          id: 'row-1',
          sellerId: 's1',
          uploadId: 'up-1',
          rowNumber: 7,
          status: StagedRowStatus.NEEDS_INPUT,
          data: GOOD_ROW,
          problems: [],
          duplicateOf: null,
          ...over,
        })),
        update: jest.fn(async () => ({})),
      },
      productVariant: { findFirst: jest.fn(async () => ({ id: 'v1' })) },
    },
  } as unknown as PrismaService;
  const svc = new StagedOrderRowService(prisma, { create } as unknown as OrderService);
  return { svc, create };
}

/**
 * A row fixed on the pending page becomes THE SAME KIND OF ORDER the
 * rest of its spreadsheet became.
 *
 * It did not. This call passed neither `source` nor `initialStatus`, so
 * `OrderService.create` used its own defaults and produced a MANUAL
 * order in DRAFT — while the bulk processor passes PENDING_CONFIRMATION
 * because ORD-9 says "CSV is submission, not drafting".
 *
 * The failure was silent in the worst available way: a DRAFT is never
 * enqueued for a confirmation call (CC-6 enqueues on entry to
 * PENDING_CONFIRMATION), so nobody ever rang that customer and the
 * parcel never moved — while the row left the queue, the dialog said
 * "it becomes an order", and the order sat in the list beside its four
 * siblings looking like one of them. Found by filming B3 (2026-09-30).
 */
describe('StagedOrderRowService.importRow — what the fixed row becomes', () => {
  it('submits it for confirmation, exactly as the bulk import does', async () => {
    const { svc, create } = makeService();
    await svc.importRow('s1', 'row-1');

    const options = create.mock.calls[0]![4] as AnyArgs;
    expect(options.initialStatus).toBe(OrderStatus.PENDING_CONFIRMATION);
  });

  it('records that it came from the upload, not from somebody typing it', async () => {
    const { svc, create } = makeService();
    await svc.importRow('s1', 'row-1');

    const options = create.mock.calls[0]![4] as AnyArgs;
    expect(options.source).toBe(OrderSource.BULK_UPLOAD);
    expect(options.bulkUploadId).toBe('up-1');
  });
});
