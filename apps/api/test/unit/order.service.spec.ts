import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ActorType, OrderSource, OrderStatus, PaymentMode, Prisma } from '@skydrop/db';
import { OrderService } from '../../src/modules/order/services/order.service';
import { OrderStateMachineService } from '../../src/modules/order/services/order-state-machine.service';
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

function makeService(
  opts: {
    variants?: Map<string, AnyArgs>;
    existing?: AnyArgs | null;
    openOrders?: AnyArgs[];
  } = {},
) {
  const orderCreate = jest.fn(async (args: { data: AnyArgs }) => ({
    id: 'o1',
    ...args.data,
    items: [],
  }));
  const orderUpdate = jest.fn(async (args: { data: AnyArgs }) => ({
    id: 'o1',
    ...args.data,
    items: [],
  }));
  const orderFindFirst = jest.fn(async () => opts.existing ?? null);
  const orderFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(async () => [{ id: 'o1' }]);
  const orderCount = jest.fn<Promise<number>, [AnyArgs]>(async () => 1);
  const orderItemDeleteMany = jest.fn(async () => ({ count: 1 }));
  const orderItemUpdate = jest.fn(async () => ({ id: 'oi1' }));
  const txClient = {
    order: { create: orderCreate, update: orderUpdate },
    orderItem: { deleteMany: orderItemDeleteMany, update: orderItemUpdate },
  };

  // R5 — the at-placement hook reads the order + the default-warehouse
  // setting post-commit. Returning null from findUnique makes it a clean
  // early-return no-op here; the hook's own behaviour is covered in
  // early-reservation.service.spec.ts.
  const orderFindUnique = jest.fn(async () => null);
  const systemSettingFindUnique = jest.fn(async () => null);

  const client = {} as {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    order: {
      findFirst: typeof orderFindFirst;
      findMany: typeof orderFindMany;
      count: typeof orderCount;
      findUnique: typeof orderFindUnique;
    };
    systemSetting: { findUnique: typeof systemSettingFindUnique };
  };
  // Attach $transaction AFTER the literal (CLAUDE testing note: avoids
  // TS7024 implicit-any from self-reference).
  client.$transaction = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient);
  client.order = {
    findFirst: orderFindFirst,
    findMany: orderFindMany,
    count: orderCount,
    findUnique: orderFindUnique,
  };
  client.systemSetting = { findUnique: systemSettingFindUnique };

  const numbering = { nextOrderNumber: jest.fn(async () => 'SD-2026-26-000001') };
  const customers = {
    findOrCreate: jest.fn(async () => ({ id: 'c1', sellerId: 's1' })),
    recordNewOrder: jest.fn(async () => undefined),
  };
  const events = {
    created: jest.fn<Promise<{ id: string }>, unknown[]>(async () => ({ id: 'e1' })),
    statusChanged: jest.fn(async () => ({ id: 'e2' })),
    note: jest.fn(async () => ({ id: 'e3' })),
  };
  const addressCache = { recordAddress: jest.fn(async () => undefined) };
  const addressValidation = { assertValid: jest.fn(async () => 'Karnataka') };
  const variants = opts.variants ?? new Map([['v1', resolvedVariant()]]);
  const catalog = {
    getVariantsByIds: jest.fn(async () => variants),
    getVariantBySku: jest.fn(async () => resolvedVariant()),
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const stateMachine = new OrderStateMachineService();

  const enqueueOrder = jest.fn(async () => ({ entry: {}, created: true }));
  const callQueue = { enqueueOrder };

  // M15→M6 best-effort post-commit hook: tests treat as a no-op.
  const persistForOrderSystem = jest.fn(async () => ({ skipped: true, reason: 'TEST' }));
  const orderCharges = { persistForOrderSystem };

  // R5 at-placement booking: another best-effort post-commit hook. Tests
  // treat it as a no-op (the setting is off by default anyway).
  const reserveAtPlacement = jest.fn(async () => ({ reserved: 0, skipped: 0, enabled: false }));
  const earlyReservations = { reserveAtPlacement };

  // No open orders by default, so these cases describe a first order to
  // a customer. The duplicate path has its own suite.
  const findOpenOrdersForPhone = jest.fn(async () => opts.openOrders ?? []);
  const reputation = { findOpenOrdersForPhone };

  const svc = new OrderService(
    { client } as unknown as PrismaService,
    numbering as never,
    customers as never,
    reputation as never,
    events as never,
    addressCache as never,
    addressValidation as never,
    catalog as never,
    audit as never,
    stateMachine,
    callQueue as never,
    orderCharges as never,
    earlyReservations as never,
  );
  return {
    svc,
    findOpenOrdersForPhone,
    enqueueOrder,
    orderCreate,
    orderUpdate,
    orderFindFirst,
    orderFindMany,
    orderCount,
    orderItemDeleteMany,
    orderItemUpdate,
    numbering,
    customers,
    events,
    addressCache,
    addressValidation,
    catalog,
    audit,
  };
}

describe('OrderService.create', () => {
  it('creates a DRAFT order, tx-wrapped, with full snapshot and no reservation (ORD-10)', async () => {
    const { svc, orderCreate, numbering, customers, events, addressCache, audit } = makeService();

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

  it('rejects a variant owned by another seller', async () => {
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
    (
      svc as unknown as { addressValidation: { assertValid: jest.Mock } }
    ).addressValidation.assertValid = jest.fn(async () => {
      throw new BadRequestException('bad PIN');
    });
    await expect(svc.create('s1', baseDto(), ACTOR, CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(numbering.nextOrderNumber).not.toHaveBeenCalled();
  });
});

function existingOrder(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'o1',
    sellerId: 's1',
    orderNumber: 'SD-2026-26-000001',
    status: OrderStatus.DRAFT,
    customerId: 'c1',
    recipientName: 'Asha',
    recipientPhoneE164: '+919876543210',
    recipientAltPhoneE164: null,
    recipientEmail: null,
    recipientPostalCode: '560001',
    recipientStateProvince: 'Karnataka',
    recipientCountryCode: 'IN',
    paymentMode: PaymentMode.COD,
    codAmountInr: new Prisma.Decimal(999),
    items: [],
    ...over,
  };
}

describe('OrderService.submit', () => {
  it('moves DRAFT → PENDING_CONFIRMATION with a status event + CC-6 enqueue', async () => {
    const { svc, orderUpdate, events, enqueueOrder } = makeService({
      existing: existingOrder(),
    });
    await svc.submit('s1', 'o1', ACTOR, CTX);
    expect(orderUpdate.mock.calls[0]![0].data).toMatchObject({
      status: OrderStatus.PENDING_CONFIRMATION,
    });
    expect(events.statusChanged).toHaveBeenCalledTimes(1);
    expect(enqueueOrder).toHaveBeenCalledWith('o1', CTX);
  });

  it('rejects submit from a non-DRAFT status', async () => {
    const { svc } = makeService({
      existing: existingOrder({ status: OrderStatus.CONFIRMED }),
    });
    await expect(svc.submit('s1', 'o1', ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'NOT_SUBMITTABLE' },
    });
  });

  it('404s when the order is not owned / missing', async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.submit('s1', 'o1', ACTOR, CTX)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderService.cancel', () => {
  it('cancels a PENDING_CONFIRMATION order with reason + no stock release', async () => {
    const { svc, orderUpdate, events } = makeService({
      existing: existingOrder({ status: OrderStatus.PENDING_CONFIRMATION }),
    });
    await svc.cancel('s1', 'o1', {}, ACTOR, CTX);
    const data = orderUpdate.mock.calls[0]![0].data as AnyArgs;
    expect(data.status).toBe(OrderStatus.CANCELLED);
    expect(data.cancellationReason).toBe('SELLER_REQUESTED');
    expect(data.cancelledAt).toBeInstanceOf(Date);
    expect(events.statusChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses to cancel a CONFIRMED order here (needs stock release)', async () => {
    const { svc } = makeService({
      existing: existingOrder({ status: OrderStatus.CONFIRMED }),
    });
    await expect(svc.cancel('s1', 'o1', {}, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'CANCEL_NEEDS_STOCK_RELEASE' },
    });
  });

  it('refuses to cancel a terminal order', async () => {
    const { svc } = makeService({
      existing: existingOrder({ status: OrderStatus.DELIVERED }),
    });
    await expect(svc.cancel('s1', 'o1', {}, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'NOT_CANCELLABLE' },
    });
  });
});

describe('OrderService.edit', () => {
  it('edits a DRAFT note and writes a note event', async () => {
    const { svc, orderUpdate, events } = makeService({ existing: existingOrder() });
    await svc.edit('s1', 'o1', { sellerNotes: 'rush' }, ACTOR, CTX);
    expect(orderUpdate.mock.calls[0]![0].data).toMatchObject({ sellerNotes: 'rush' });
    expect(events.note).toHaveBeenCalledTimes(1);
  });

  it('revalidates the address and persists canonical state on recipient edit', async () => {
    const { svc, orderUpdate, addressValidation } = makeService({
      existing: existingOrder({ status: OrderStatus.PENDING_CONFIRMATION }),
    });
    await svc.edit('s1', 'o1', { recipientCity: 'Mysuru' }, ACTOR, CTX);
    expect(addressValidation.assertValid).toHaveBeenCalledTimes(1);
    expect(orderUpdate.mock.calls[0]![0].data).toMatchObject({
      recipientCity: 'Mysuru',
      recipientStateProvince: 'Karnataka',
    });
  });

  it('rejects items/economics edits in PENDING_CONFIRMATION', async () => {
    const { svc } = makeService({
      existing: existingOrder({ status: OrderStatus.PENDING_CONFIRMATION }),
    });
    await expect(svc.edit('s1', 'o1', { isUrgent: true }, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'EDIT_SCOPE_PENDING' },
    });
  });

  it('re-links the customer when the recipient phone is corrected', async () => {
    const { svc, customers } = makeService({ existing: existingOrder() });
    await svc.edit('s1', 'o1', { recipientPhoneE164: '+919811111111' }, ACTOR, CTX);
    expect(customers.findOrCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sellerId: 's1', phoneE164: '+919811111111' }),
    );
  });

  it('replaces the line set in DRAFT and recomputes derived totals', async () => {
    const { svc, orderUpdate, orderItemDeleteMany } = makeService({
      existing: existingOrder(),
    });
    await svc.edit('s1', 'o1', { items: [{ variantId: 'v1', quantity: 3 }] }, ACTOR, CTX);
    expect(orderItemDeleteMany).toHaveBeenCalledTimes(1);
    const data = orderUpdate.mock.calls[0]![0].data as AnyArgs;
    expect((data.declaredValueInr as Prisma.Decimal).toString()).toBe('600'); // 200 × 3
    expect(data.totalWeightGrams).toBe(1500); // 500 × 3
  });

  it('refuses to edit a CONFIRMED order (god-mode is separate)', async () => {
    const { svc } = makeService({
      existing: existingOrder({ status: OrderStatus.CONFIRMED }),
    });
    await expect(svc.edit('s1', 'o1', { sellerNotes: 'x' }, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'NOT_EDITABLE' },
    });
  });

  it('rejects an empty edit', async () => {
    const { svc } = makeService({ existing: existingOrder() });
    await expect(svc.edit('s1', 'o1', {}, ACTOR, CTX)).rejects.toMatchObject({
      response: { code: 'NOTHING_TO_UPDATE' },
    });
  });
});

describe('OrderService admin reads', () => {
  it('adminList is cross-seller by default (no sellerId in where)', async () => {
    const { svc, orderFindMany } = makeService();
    const res = await svc.adminList({});
    const arg = orderFindMany.mock.calls[0]![0] as { where: AnyArgs };
    expect(arg.where).toEqual({ deletedAt: null });
    expect(res).toMatchObject({ total: 1, page: 1, pageSize: 20 });
  });

  it('adminList narrows to one seller when sellerId is set', async () => {
    const { svc, orderFindMany } = makeService();
    await svc.adminList({ sellerId: 's9', status: OrderStatus.CONFIRMED });
    const arg = orderFindMany.mock.calls[0]![0] as { where: AnyArgs };
    expect(arg.where).toMatchObject({
      deletedAt: null,
      sellerId: 's9',
      status: OrderStatus.CONFIRMED,
    });
  });

  it('adminGetById returns the order (no seller scope)', async () => {
    const { svc } = makeService({ existing: existingOrder() });
    await expect(svc.adminGetById('o1')).resolves.toMatchObject({ id: 'o1' });
  });

  it('adminGetById 404s a missing/soft-deleted order', async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.adminGetById('gone')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderService.create — bulk options (commit 19/21 gap-fill)', () => {
  it('honors initialStatus=PENDING_CONFIRMATION + bulkUploadId + CC-6 enqueue', async () => {
    const { svc, orderCreate, events, enqueueOrder } = makeService();
    await svc.create('s1', baseDto(), ACTOR, CTX, {
      source: OrderSource.BULK_UPLOAD,
      initialStatus: OrderStatus.PENDING_CONFIRMATION,
      bulkUploadId: 'bulk-1',
    });
    const data = orderCreate.mock.calls[0]![0].data as AnyArgs;
    expect(data.status).toBe(OrderStatus.PENDING_CONFIRMATION);
    expect(data.bulkUploadId).toBe('bulk-1');
    // events.created carries the real initial status (not hardcoded DRAFT)
    expect(events.created.mock.calls[0]![4]).toBe(OrderStatus.PENDING_CONFIRMATION);
    // CC-6: a straight-to-PENDING_CONFIRMATION create joins the queue
    expect(enqueueOrder).toHaveBeenCalledTimes(1);
  });

  it('does NOT enqueue a DRAFT create (CC-6 only fires on PENDING_CONFIRMATION)', async () => {
    const { svc, enqueueOrder } = makeService();
    await svc.create('s1', baseDto(), ACTOR, CTX);
    expect(enqueueOrder).not.toHaveBeenCalled();
  });

  it('rejects an initialStatus other than DRAFT/PENDING_CONFIRMATION', async () => {
    const { svc } = makeService();
    await expect(
      svc.create('s1', baseDto(), ACTOR, CTX, {
        initialStatus: OrderStatus.CONFIRMED,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_INITIAL_STATUS' } });
  });
});

function patchableOrder(over: AnyArgs = {}): AnyArgs {
  return {
    id: 'o1',
    status: OrderStatus.PENDING_CONFIRMATION,
    recipientName: 'Asha',
    recipientPhoneE164: '+919876543210',
    recipientEmail: null,
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: null,
    recipientLandmark: null,
    recipientCity: 'Bengaluru',
    recipientStateProvince: 'Karnataka',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
    codAmountInr: new Prisma.Decimal(999),
    customerId: 'c1',
    items: [{ id: 'oi1', variantId: 'v1', quantity: 2 }],
    ...over,
  };
}

const PATCH = {
  productSku: 'SKU-1',
  quantity: 2,
  customerName: 'Asha',
  customerPhone: '+919876543210',
  addressLine1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pinCode: '560001',
  codAmount: 999, // matches patchableOrder's codAmountInr so the
  // identical-re-upload case is genuinely a no-op
};

describe('OrderService.applyBulkPatch — ORD-9 (commit 21 gap-fill)', () => {
  it('returns UNCHANGED for an identical re-upload (no write)', async () => {
    const { svc, orderUpdate } = makeService({ existing: patchableOrder() });
    const r = await svc.applyBulkPatch('s1', 'o1', { ...PATCH }, ACTOR);
    expect(r).toBe('UNCHANGED');
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('PATCHes a changed recipient field + writes a note event', async () => {
    const { svc, orderUpdate, events } = makeService({ existing: patchableOrder() });
    const r = await svc.applyBulkPatch('s1', 'o1', { ...PATCH, city: 'Mysuru' }, ACTOR);
    expect(r).toBe('PATCHED');
    expect((orderUpdate.mock.calls[0]![0].data as AnyArgs).recipientCity).toBe('Mysuru');
    expect(events.note).toHaveBeenCalledTimes(1);
  });

  it('re-resolves the per-seller customer when the phone changes', async () => {
    const { svc, customers } = makeService({ existing: patchableOrder() });
    await svc.applyBulkPatch('s1', 'o1', { ...PATCH, customerPhone: '+919800000000' }, ACTOR);
    expect(customers.findOrCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phoneE164: '+919800000000' }),
    );
  });

  it('re-snapshots the line when the SKU moves', async () => {
    const { svc, orderItemUpdate, catalog } = makeService({ existing: patchableOrder() });
    (catalog.getVariantBySku as jest.Mock).mockResolvedValueOnce(
      resolvedVariant({ variantId: 'v2', skuCode: 'SKU-2' }),
    );
    const r = await svc.applyBulkPatch('s1', 'o1', { ...PATCH, productSku: 'SKU-2' }, ACTOR);
    expect(r).toBe('PATCHED');
    expect(orderItemUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses to patch a CONFIRMED+ order', async () => {
    const { svc } = makeService({
      existing: patchableOrder({ status: OrderStatus.CONFIRMED }),
    });
    await expect(svc.applyBulkPatch('s1', 'o1', { ...PATCH }, ACTOR)).rejects.toMatchObject({
      response: { code: 'BULK_PATCH_NOT_ALLOWED' },
    });
  });

  it('404s a missing order', async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.applyBulkPatch('s1', 'gone', { ...PATCH }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an unresolvable SKU', async () => {
    const { svc, catalog } = makeService({ existing: patchableOrder() });
    (catalog.getVariantBySku as jest.Mock).mockResolvedValueOnce(null);
    await expect(svc.applyBulkPatch('s1', 'o1', { ...PATCH }, ACTOR)).rejects.toMatchObject({
      response: { code: 'VARIANT_NOT_FOUND' },
    });
  });
});
