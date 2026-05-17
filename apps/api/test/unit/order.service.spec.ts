import { BadRequestException, ConflictException } from '@nestjs/common';
import { ActorType, OrderSource, OrderStatus, PaymentMode, Prisma } from '@skydrop/db';
import { OrderService } from '../../src/modules/order/services/order.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CreateOrderDto } from '../../src/modules/order/dto/create-order.dto';

type AnyArgs = Record<string, unknown>;

const CTX = { ipAddress: '1.2.3.4', userAgent: 'jest', requestId: 'req-1' };
const ACTOR = { type: ActorType.SELLER, id: 'seller-user-1' };

function resolvedVariant(over: Partial<Record<string, unknown>> = {}): AnyArgs {
  return {
    variantId: 'v1',
    productId: 'p1',
    sellerId: 's1',
    categoryId: null,
    skuCode: 'SKU-1',
    variantLabel: 'Red / M',
    status: 'ACTIVE',
    attributes: {},
    weightGrams: 500,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    declaredValueInr: new Prisma.Decimal(200),
    hsCode: '6109',
    gstRate: new Prisma.Decimal(18),
    lowStockThreshold: null,
    productName: 'Cotton Tee',
    imageUrl: 'https://cdn/x.jpg',
    ...over,
  };
}

function baseDto(over: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    recipientName: 'Asha',
    recipientPhoneE164: '+919876543210',
    recipientAddressLine1: '12 MG Road',
    recipientCity: 'Bengaluru',
    recipientStateProvince: 'Karnataka',
    recipientPostalCode: '560001',
    paymentMode: PaymentMode.COD,
    codAmountInr: 999,
    items: [{ variantId: 'v1', quantity: 2 }],
    ...over,
  } as CreateOrderDto;
}

function makeService(opts: { variants?: Map<string, AnyArgs> } = {}) {
  const orderCreate = jest.fn(async (args: { data: AnyArgs }) => ({
    id: 'o1',
    ...args.data,
    items: [],
  }));
  const txClient = { order: { create: orderCreate } };

  const client = {} as { $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> };
  // Attach $transaction AFTER the literal (CLAUDE testing note: avoids
  // TS7024 implicit-any from self-reference).
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);

  const numbering = { nextOrderNumber: jest.fn(async () => 'SD-2026-26-000001') };
  const customers = {
    findOrCreate: jest.fn(async () => ({ id: 'c1', sellerId: 's1' })),
    recordNewOrder: jest.fn(async () => undefined),
  };
  const events = { created: jest.fn(async () => ({ id: 'e1' })) };
  const addressCache = { recordAddress: jest.fn(async () => undefined) };
  const addressValidation = { assertValid: jest.fn(async () => 'Karnataka') };
  const variants = opts.variants ?? new Map([['v1', resolvedVariant()]]);
  const catalog = { getVariantsByIds: jest.fn(async () => variants) };
  const audit = { log: jest.fn(async () => 'a1') };

  const svc = new OrderService(
    { client } as unknown as PrismaService,
    numbering as never,
    customers as never,
    events as never,
    addressCache as never,
    addressValidation as never,
    catalog as never,
    audit as never,
  );
  return { svc, orderCreate, numbering, customers, events, addressCache, addressValidation, catalog, audit };
}

describe('OrderService.create', () => {
  it('creates a DRAFT order, tx-wrapped, with full snapshot and no reservation (ORD-10)', async () => {
    const { svc, orderCreate, numbering, customers, events, addressCache, audit } =
      makeService();

    await svc.create('s1', baseDto(), ACTOR, CTX);

    const data = orderCreate.mock.calls[0]![0].data as AnyArgs;
    expect(data.status).toBe(OrderStatus.DRAFT);
    expect(data.source).toBe(OrderSource.MANUAL);
    expect(data.orderNumber).toBe('SD-2026-26-000001');
    expect(data.recipientStateProvince).toBe('Karnataka'); // canonical from validator
    expect(data.placedAt).toBeInstanceOf(Date);

    // Item snapshot copied from the catalog read boundary.
    const items = (data.items as { create: AnyArgs[] }).create;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      variantId: 'v1',
      skuCode: 'SKU-1',
      productName: 'Cotton Tee',
      variantLabel: 'Red / M',
      imageUrl: 'https://cdn/x.jpg',
      quantity: 2,
      unitWeightGrams: 500,
      hsCode: '6109',
    });
    // qtyReserved is NOT set here — it stays at its schema 0 default.
    expect(items[0]).not.toHaveProperty('qtyReserved');

    // Number allocated inside the tx; collaborators all ran in-tx.
    expect(numbering.nextOrderNumber).toHaveBeenCalledTimes(1);
    expect(customers.findOrCreate).toHaveBeenCalledTimes(1);
    expect(customers.recordNewOrder).toHaveBeenCalledWith(
      expect.anything(),
      'c1',
      expect.any(Date),
    );
    expect(events.created).toHaveBeenCalledTimes(1);
    expect(addressCache.recordAddress).toHaveBeenCalledTimes(1); // MANUAL feeds cache
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('derives declaredValue and totalWeight from item snapshots when omitted', async () => {
    const { svc, orderCreate } = makeService();
    await svc.create('s1', baseDto(), ACTOR, CTX);
    const data = orderCreate.mock.calls[0]![0].data as AnyArgs;
    expect((data.declaredValueInr as Prisma.Decimal).toString()).toBe('400'); // 200 × 2
    expect(data.totalWeightGrams).toBe(1000); // 500 × 2
  });

  it('does NOT feed the address cache for non-MANUAL sources', async () => {
    const { svc, addressCache } = makeService();
    await svc.create('s1', baseDto(), ACTOR, CTX, { source: OrderSource.BULK_UPLOAD });
    expect(addressCache.recordAddress).not.toHaveBeenCalled();
  });

  it('rejects an archived variant (catalog rule #8)', async () => {
    const { svc } = makeService({
      variants: new Map([['v1', resolvedVariant({ status: 'ARCHIVED' })]]),
    });
    await expect(svc.create('s1', baseDto(), ACTOR, CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects a variant owned by another seller", async () => {
    const { svc } = makeService({
      variants: new Map([['v1', resolvedVariant({ sellerId: 'other' })]]),
    });
    await expect(svc.create('s1', baseDto(), ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'VARIANT_NOT_FOUND' },
    });
  });

  it('requires codAmountInr > 0 for COD', async () => {
    const { svc } = makeService();
    const dto = baseDto();
    delete (dto as { codAmountInr?: number }).codAmountInr;
    await expect(svc.create('s1', dto, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'COD_AMOUNT_REQUIRED' },
    });
  });

  it('forbids codAmountInr on PREPAID', async () => {
    const { svc } = makeService();
    await expect(
      svc.create(
        's1',
        baseDto({ paymentMode: PaymentMode.PREPAID, codAmountInr: 100 }),
        ACTOR,
        CTX,
      ),
    ).rejects.toMatchObject({ response: { code: 'COD_AMOUNT_NOT_ALLOWED' } });
  });

  it('maps a duplicate sellerOrderRef (P2002) to a 409', async () => {
    const { svc, orderCreate } = makeService();
    orderCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      svc.create('s1', baseDto({ sellerOrderRef: 'REF-1' }), ACTOR, CTX),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('propagates address-validation failure before any write', async () => {
    const { svc, numbering } = makeService();
    // Re-wire the validator to throw.
    (svc as unknown as { addressValidation: { assertValid: jest.Mock } }).addressValidation.assertValid =
      jest.fn(async () => {
        throw new BadRequestException('bad PIN');
      });
    await expect(svc.create('s1', baseDto(), ACTOR, CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(numbering.nextOrderNumber).not.toHaveBeenCalled();
  });
});
