import { NotFoundException } from '@nestjs/common';
import { OrderSource, OrderStatus, PaymentMode, Prisma } from '@skydrop/db';
import { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type AnyArgs = Record<string, unknown>;

function row(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'o1',
    orderNumber: 'SD-2026-26-000001',
    sellerId: 's1',
    customerId: 'c1',
    sellerOrderRef: null,
    source: OrderSource.MANUAL,
    status: OrderStatus.CONFIRMED,
    isUrgent: false,
    isHighRisk: false,
    hasAdminOverride: false,
    recipientName: 'Asha',
    recipientPhoneE164: '+919876543210',
    recipientAltPhoneE164: null,
    recipientEmail: null,
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: null,
    recipientLandmark: null,
    recipientCity: 'Bengaluru',
    recipientStateProvince: 'Karnataka',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
    paymentMode: PaymentMode.COD,
    codAmountInr: new Prisma.Decimal(999),
    declaredValueInr: new Prisma.Decimal(400),
    totalWeightGrams: 1000,
    placedAt: new Date('2026-05-17T00:00:00Z'),
    confirmedAt: new Date('2026-05-17T01:00:00Z'),
    cancelledAt: null,
    items: [
      {
        id: 'oi1',
        variantId: 'v1',
        skuCode: 'SKU-1',
        productName: 'Cotton Tee',
        variantLabel: 'Red / M',
        imageUrl: 'https://cdn/x.jpg',
        quantity: 2,
        unitWeightGrams: 500,
        unitDeclaredValueInr: new Prisma.Decimal(200),
        unitPriceInr: null,
        qtyReserved: 2,
        qtyPicked: 0,
        qtyPacked: 0,
        qtyShipped: 0,
        qtyDelivered: 0,
        qtyReturned: 0,
      },
    ],
    ...over,
  };
}

function makeService(opts: { found?: AnyArgs | null; many?: AnyArgs[] } = {}) {
  const findFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.found === undefined ? row() : opts.found,
  );
  const findMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => opts.many ?? [row()]);
  const client = { order: { findFirst, findMany } };
  const svc = new OrderReadService({ client } as unknown as PrismaService);
  return { svc, findFirst, findMany };
}

describe('OrderReadService', () => {
  it('resolves an order into a frozen ResolvedOrder snapshot', async () => {
    const { svc } = makeService();
    const o = await svc.getById('o1');
    expect(o).not.toBeNull();
    expect(Object.isFrozen(o)).toBe(true);
    expect(Object.isFrozen(o!.recipient)).toBe(true);
    expect(Object.isFrozen(o!.items)).toBe(true);
    expect(o!.recipient.city).toBe('Bengaluru');
    expect(o!.items[0]!.skuCode).toBe('SKU-1');
    expect(o!.items[0]!.qtyReserved).toBe(2);
  });

  it('excludes soft-deleted orders (findFirst filters deletedAt)', async () => {
    const { svc, findFirst } = makeService({ found: null });
    expect(await svc.getById('gone')).toBeNull();
    const arg = findFirst.mock.calls[0]![0] as { where: AnyArgs };
    expect(arg.where).toMatchObject({ deletedAt: null });
  });

  it('requireById throws 404 when missing', async () => {
    const { svc } = makeService({ found: null });
    await expect(svc.requireById('gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getManyByIds dedupes ids and returns a map; empty in → empty out', async () => {
    const { svc, findMany } = makeService({ many: [row(), row({ id: 'o2' })] });
    const map = await svc.getManyByIds(['o1', 'o1', 'o2']);
    const arg = findMany.mock.calls[0]![0] as { where: { id: { in: string[] } } };
    expect(arg.where.id.in).toEqual(['o1', 'o2']);
    expect([...map.keys()].sort()).toEqual(['o1', 'o2']);

    const empty = makeService();
    expect((await empty.svc.getManyByIds([])).size).toBe(0);
    expect(empty.findMany).not.toHaveBeenCalled();
  });
});
