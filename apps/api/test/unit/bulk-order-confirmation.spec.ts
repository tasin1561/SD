import { ActorType } from '@skydrop/db';

import { REQUIRE_PERMISSIONS_KEY } from '../../src/common/auth/require-permissions.decorator';
import { REQUIRE_SELLER_PERMISSIONS_KEY } from '../../src/common/auth/require-seller-permissions.decorator';
import { REQUIRE_STORE_PERMISSIONS_KEY } from '../../src/common/auth/require-store-permissions.decorator';
import { AdminOrderBulkController } from '../../src/modules/order/controllers/admin-order-bulk.controller';
import { AdminOrderController } from '../../src/modules/order/controllers/admin-order.controller';
import { SellerOrderBulkController } from '../../src/modules/order/controllers/seller-order-bulk.controller';
import { SellerOrderController } from '../../src/modules/order/controllers/seller-order.controller';
import { SellerInvoiceBulkController } from '../../src/modules/invoice/seller-invoice-bulk.controller';
import { SellerInvoiceController } from '../../src/modules/invoice/seller-invoice.controller';
import { StoreOrderBulkController } from '../../src/modules/reseller-order/controllers/store-order-bulk.controller';
import { StoreOrderController } from '../../src/modules/reseller-order/controllers/store-order.controller';
import { AdminOrderLabelBulkController } from '../../src/modules/warehouse-printing/controllers/admin-order-label-bulk.controller';
import { WarehousePrintingController } from '../../src/modules/warehouse-printing/controllers/warehouse-printing.controller';
import {
  BulkOrderConfirmationService,
  mapConfirm,
  mapSend,
} from '../../src/modules/order/services/bulk-order-confirmation.service';
import type { AwaitingConfirmationService } from '../../src/modules/order/services/awaiting-confirmation.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

type Ctor = { prototype: Record<string, unknown> };

/** The keys a handler really declares: its own, else its class's. */
function keys(metaKey: string, cls: Ctor, handler: string): readonly string[] {
  const own: unknown = Reflect.getMetadata(metaKey, cls.prototype[handler] as object);
  const klass: unknown = Reflect.getMetadata(metaKey, cls);
  return (own ?? klass) as readonly string[];
}

describe('bulk confirmation wrappers', () => {
  it('maps every single-order outcome onto DONE / SKIPPED / FAILED', () => {
    const o = (r: Parameters<typeof mapSend>[0]): string => mapSend(r, 'SD-1').outcome;
    expect(o({ orderId: 'a', outcome: 'QUEUED' })).toBe('DONE');
    expect(o({ orderId: 'a', outcome: 'ALREADY_QUEUED' })).toBe('SKIPPED');
    expect(o({ orderId: 'a', outcome: 'NOT_FOUND' })).toBe('SKIPPED');
    expect(o({ orderId: 'a', outcome: 'NOT_PENDING_CONFIRMATION' })).toBe('SKIPPED');
    expect(o({ orderId: 'a', outcome: 'FAILED', message: 'boom' })).toBe('FAILED');

    const c = (r: Parameters<typeof mapConfirm>[0]): string => mapConfirm(r, null).outcome;
    expect(c({ orderId: 'a', outcome: 'CONFIRMED' })).toBe('DONE');
    expect(c({ orderId: 'a', outcome: 'OUT_OF_STOCK' })).toBe('SKIPPED');
    expect(c({ orderId: 'a', outcome: 'REFUSED', code: 'X', message: 'no' })).toBe('SKIPPED');
    expect(c({ orderId: 'a', outcome: 'FAILED' })).toBe('FAILED');
    // The server's own code and words travel verbatim.
    expect(
      mapConfirm({ orderId: 'a', outcome: 'REFUSED', code: 'POLICY', message: 'No' }, null),
    ).toEqual({
      orderId: 'a',
      orderNumber: null,
      outcome: 'SKIPPED',
      code: 'POLICY',
      message: 'No',
    });
  });

  it('passes the seller scope to the existing service and hides foreign order numbers', async () => {
    const sendToAgents = jest.fn().mockResolvedValue({
      results: [
        { orderId: 'mine', outcome: 'QUEUED' },
        { orderId: 'theirs', outcome: 'NOT_FOUND' },
        { orderId: 'late', outcome: 'NOT_PENDING_CONFIRMATION' },
      ],
    });
    const findMany = jest.fn().mockResolvedValue([
      { id: 'mine', orderNumber: 'SD-1' },
      { id: 'late', orderNumber: 'SD-3' },
    ]);
    const svc = new BulkOrderConfirmationService(
      { sendToAgents } as unknown as AwaitingConfirmationService,
      { client: { order: { findMany } } } as unknown as PrismaService,
    );
    const res = await svc.sendCalls(['mine', 'theirs', 'late'], { scopeSellerId: 'sellerA' });

    expect(sendToAgents).toHaveBeenCalledWith(['mine', 'theirs', 'late'], {
      scopeSellerId: 'sellerA',
    });
    expect((findMany.mock.calls[0]?.[0] as { where: { sellerId: string } }).where.sellerId).toBe(
      'sellerA',
    );
    expect(res).toMatchObject({ done: 1, skipped: 2, failed: 0 });
    expect(res.results[1]).toEqual({
      orderId: 'theirs',
      orderNumber: null,
      outcome: 'SKIPPED',
      code: 'NOT_FOUND',
    });
  });

  it('confirm-without-call carries the real actor and no seller scope for staff', async () => {
    const confirmWithoutCall = jest
      .fn()
      .mockResolvedValue({ results: [{ orderId: 'a', outcome: 'CONFIRMED' }] });
    const svc = new BulkOrderConfirmationService(
      { confirmWithoutCall } as unknown as AwaitingConfirmationService,
      {
        client: { order: { findMany: jest.fn().mockResolvedValue([]) } },
      } as unknown as PrismaService,
    );
    const actor = { type: ActorType.STAFF, id: 'staff-1' };
    await svc.confirmWithoutCall(['a'], { actor });
    expect(confirmWithoutCall).toHaveBeenCalledWith(['a'], { actor });
  });
});

describe('bulk routes ask for the single action’s permission', () => {
  it('client: confirmations need orders.create like the single ones; export needs orders.view', () => {
    const single = (h: string): readonly string[] =>
      keys(REQUIRE_SELLER_PERMISSIONS_KEY, SellerOrderController as unknown as Ctor, h);
    const bulk = (h: string): readonly string[] =>
      keys(REQUIRE_SELLER_PERMISSIONS_KEY, SellerOrderBulkController as unknown as Ctor, h);
    expect(bulk('sendConfirmationCalls')).toEqual(single('sendConfirmationCalls'));
    expect(bulk('confirmWithoutCall')).toEqual(single('confirmWithoutCall'));
    expect(bulk('export')).toEqual(single('list'));
  });

  it('client: bulk invoices need the single invoice key', () => {
    expect(
      keys(
        REQUIRE_SELLER_PERMISSIONS_KEY,
        SellerInvoiceBulkController as unknown as Ctor,
        'invoices',
      ),
    ).toEqual(
      keys(REQUIRE_SELLER_PERMISSIONS_KEY, SellerInvoiceController as unknown as Ctor, 'pdf'),
    );
  });

  it('store and associate: export needs the list key', () => {
    expect(
      keys(REQUIRE_STORE_PERMISSIONS_KEY, StoreOrderBulkController as unknown as Ctor, 'export'),
    ).toEqual(keys(REQUIRE_STORE_PERMISSIONS_KEY, StoreOrderController as unknown as Ctor, 'list'));
  });

  it('admin: confirmations, export and labels', () => {
    const k = (cls: unknown, h: string): readonly string[] =>
      keys(REQUIRE_PERMISSIONS_KEY, cls as Ctor, h);
    expect(k(AdminOrderBulkController, 'sendConfirmationCalls')).toEqual(
      k(AdminOrderController, 'sendConfirmationCalls'),
    );
    expect(k(AdminOrderBulkController, 'confirmWithoutCall')).toEqual(
      k(AdminOrderController, 'confirmWithoutCall'),
    );
    expect(k(AdminOrderBulkController, 'export')).toEqual(k(AdminOrderController, 'list'));
    // The single label print is the class-level key of the printing controller.
    expect(k(AdminOrderLabelBulkController, 'labels')).toEqual(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, WarehousePrintingController) as string[],
    );
  });
});
