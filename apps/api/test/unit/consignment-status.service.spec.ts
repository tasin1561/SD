import { ConsignmentStatusService } from '../../src/modules/consignment-core/services/consignment-status.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Any = any;

/**
 * The status is DERIVED, never hand-set.
 *
 * Storing it and setting it at six call sites is how it comes to disagree
 * with the receipts underneath it, and the disagreement is invisible: the
 * row says IN_TRANSIT, the goods are on the shelf, and nothing fails.
 */
function makeSut(opts: {
  cancelledAt?: Date | null;
  receipts?: Any[];
  transitQty?: number;
  bdQty?: number;
  current?: string;
}) {
  const updates: Any[] = [];
  const aggregate = jest.fn(async (args: Any) => {
    const isTransit = args.where.bin !== undefined;
    return { _sum: { qtyOnHand: isTransit ? (opts.transitQty ?? 0) : (opts.bdQty ?? 0) } };
  });
  const client: Any = {
    consignment: {
      findUnique: async () => ({
        id: 'cn1',
        sellerId: 's1',
        status: opts.current ?? 'PENDING',
        cancelledAt: opts.cancelledAt ?? null,
        receipts: opts.receipts ?? [],
      }),
      update: async (args: Any) => {
        updates.push(args.data);
        return args.data;
      },
    },
    stockLevel: { aggregate },
  };
  const prisma = { client } as unknown as PrismaService;
  return { svc: new ConsignmentStatusService(prisma), updates, aggregate };
}

const bd = (status: string) => ({
  id: 'gr-bd',
  leg: 'BD_INTAKE',
  status,
  warehouseId: 'w-bd',
  dispatchedAt: null,
});
const inFinal = (status: string) => ({
  id: 'gr-in',
  leg: 'IN_FINAL',
  status,
  warehouseId: 'w-in',
  dispatchedAt: new Date('2026-08-10T00:00:00Z'),
});

describe('ConsignmentStatusService.recompute', () => {
  it('cancelled beats everything, including stock still in the air', async () => {
    const sut = makeSut({
      cancelledAt: new Date(),
      transitQty: 500,
      receipts: [bd('COMPLETED')],
    });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('CANCELLED');
  });

  it('anything in a TRANSIT bin means IN_TRANSIT', async () => {
    const sut = makeSut({ transitQty: 300, bdQty: 200, receipts: [bd('COMPLETED')] });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('IN_TRANSIT');
  });

  it('a PARTIAL dispatch reads IN_TRANSIT rather than flapping back to AT_BD', async () => {
    // 300 of 500 in the air, 200 still in Dhaka. The most urgent true
    // thing about the consignment is the part that is moving.
    const sut = makeSut({
      transitQty: 300,
      bdQty: 200,
      current: 'AT_BD',
      receipts: [bd('COMPLETED'), inFinal('ARRIVING')],
    });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('IN_TRANSIT');
  });

  it('stock still standing in Bangladesh is AT_BD, however many legs landed', async () => {
    const sut = makeSut({
      transitQty: 0,
      bdQty: 200,
      receipts: [bd('COMPLETED'), inFinal('COMPLETED')],
    });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('AT_BD');
  });

  it('everything landed and nothing left behind is COMPLETED', async () => {
    const sut = makeSut({
      transitQty: 0,
      bdQty: 0,
      receipts: [bd('COMPLETED'), inFinal('COMPLETED')],
    });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('COMPLETED');
  });

  it('a DIRECT_IN consignment completes on its single leg', async () => {
    const sut = makeSut({ transitQty: 0, receipts: [inFinal('COMPLETED')] });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('COMPLETED');
  });

  it('nothing counted anywhere is still PENDING', async () => {
    const sut = makeSut({ transitQty: 0, receipts: [bd('PENDING')] });
    await expect(sut.svc.recompute('cn1')).resolves.toBe('PENDING');
  });

  it('writes only when the answer CHANGED', async () => {
    const unchanged = makeSut({ transitQty: 0, receipts: [bd('PENDING')], current: 'PENDING' });
    await unchanged.svc.recompute('cn1');
    expect(unchanged.updates).toHaveLength(0);

    const changed = makeSut({ transitQty: 5, receipts: [bd('COMPLETED')], current: 'PENDING' });
    await changed.svc.recompute('cn1');
    expect(changed.updates).toEqual([{ status: 'IN_TRANSIT' }]);
  });

  it('a vanished consignment answers PENDING rather than throwing', async () => {
    const prisma = {
      client: { consignment: { findUnique: async () => null } },
    } as unknown as PrismaService;
    await expect(new ConsignmentStatusService(prisma).recompute('gone')).resolves.toBe('PENDING');
  });
});
