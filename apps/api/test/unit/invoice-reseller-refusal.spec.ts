import { ConflictException } from '@nestjs/common';
import { OrderStatus, SellerStoreKind } from '@skydrop/db';
import {
  InvoiceService,
  RESELLER_ORDER_NO_INVOICE,
} from '../../src/modules/invoice/services/invoice.service';
import { SellerInvoiceController } from '../../src/modules/invoice/seller-invoice.controller';
import { OrderDeliveredInvoiceListener } from '../../src/modules/invoice/services/order-delivered-invoice-listener.service';
import type { OrderLifecycleEvent } from '../../src/modules/lifecycle-events/order-lifecycle-event-bus.service';

/**
 * RS-10 / owner decision 8 — "no tax invoices for reseller orders".
 *
 * An order sold by a reseller store gets no invoice from ANY path: the
 * seller's Generate button, the read, the PDF redirect, or the DELIVERED
 * listener. Every other order is unaffected.
 */
function makeInvoiceService(kind: SellerStoreKind): {
  svc: InvoiceService;
  invoiceFindUnique: jest.Mock;
  invoiceFindFirst: jest.Mock;
} {
  const invoiceFindUnique = jest.fn(async () => ({
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    pdfUrl: 'https://canonical/inv-1.pdf',
    pdfStorageKey: 'invoices/s1/INV-1.pdf',
  }));
  const invoiceFindFirst = jest.fn(async () => null);
  const prisma = {
    client: {
      order: {
        findFirst: jest.fn(async () => ({
          id: 'o1',
          status: OrderStatus.DELIVERED,
          store: { kind },
        })),
      },
      invoice: { findUnique: invoiceFindUnique, findFirst: invoiceFindFirst },
    },
  };
  const spaces = { presignGetUrl: jest.fn(async (k: string) => `https://signed/${k}`) };
  const svc = new InvoiceService(
    prisma as never,
    spaces as never,
    {} as never,
    {} as never,
    { enqueue: jest.fn() } as never,
    {} as never,
  );
  return { svc, invoiceFindUnique, invoiceFindFirst };
}

describe('InvoiceService — RS-10 no tax invoice for a reseller-store order', () => {
  it('refuses generateForOrder by name, before it touches any invoice row', async () => {
    const { svc, invoiceFindUnique } = makeInvoiceService(SellerStoreKind.RESELLER);
    await expect(svc.generateForOrder('o1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.generateForOrder('o1')).rejects.toMatchObject({
      response: { code: RESELLER_ORDER_NO_INVOICE },
    });
    expect(invoiceFindUnique).not.toHaveBeenCalled();
  });

  it('a CHANNEL order is unaffected: the existing invoice comes back as before', async () => {
    const { svc } = makeInvoiceService(SellerStoreKind.CHANNEL);
    await expect(svc.generateForOrder('o1')).resolves.toMatchObject({
      invoiceNumber: 'INV-1',
      alreadyExisted: true,
    });
    expect(await svc.isResellerOrder('o1')).toBe(false);
  });
});

describe('SellerInvoiceController — RS-10 refusal on every handler', () => {
  const SELLER = { id: 's1' } as never;

  function controllerFor(kind: SellerStoreKind): SellerInvoiceController {
    const { svc } = makeInvoiceService(kind);
    const prisma = { client: { order: { findFirst: jest.fn(async () => ({ id: 'o1' })) } } };
    return new SellerInvoiceController(svc, prisma as never);
  }

  it('GET refuses a reseller-store order with the named 409', async () => {
    await expect(controllerFor(SellerStoreKind.RESELLER).get(SELLER, 'o1')).rejects.toMatchObject({
      response: { code: RESELLER_ORDER_NO_INVOICE },
    });
  });

  it('POST (generate) refuses a reseller-store order with the named 409', async () => {
    await expect(
      controllerFor(SellerStoreKind.RESELLER).generate(SELLER, 'o1'),
    ).rejects.toMatchObject({ response: { code: RESELLER_ORDER_NO_INVOICE } });
  });

  it('the PDF redirect refuses a reseller-store order with the named 409', async () => {
    const res = { redirect: jest.fn() };
    await expect(
      controllerFor(SellerStoreKind.RESELLER).pdf(SELLER, 'o1', res as never),
    ).rejects.toMatchObject({ response: { code: RESELLER_ORDER_NO_INVOICE } });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('GET on a CHANNEL order behaves as before (404 when there is no invoice yet)', async () => {
    await expect(controllerFor(SellerStoreKind.CHANNEL).get(SELLER, 'o1')).rejects.toMatchObject({
      response: { code: 'INVOICE_NOT_FOUND' },
    });
  });
});

describe('OrderDeliveredInvoiceListener — RS-10 skips a reseller-store order quietly', () => {
  async function deliver(isReseller: boolean): Promise<jest.Mock> {
    let handler: ((e: OrderLifecycleEvent) => void) | null = null;
    const bus = {
      subscribe: (cb: (e: OrderLifecycleEvent) => void) => {
        handler = cb;
        return { unsubscribe: () => undefined };
      },
    };
    const generateForOrder = jest.fn(async () => ({}));
    const invoices = { isResellerOrder: jest.fn(async () => isReseller), generateForOrder };
    const listener = new OrderDeliveredInvoiceListener(bus as never, invoices as never);
    listener.onApplicationBootstrap();
    (handler as unknown as (e: OrderLifecycleEvent) => void)({
      orderId: 'o1',
      to: OrderStatus.DELIVERED,
    } as OrderLifecycleEvent);
    await listener.drainInFlight();
    return generateForOrder;
  }

  it('does not generate for a reseller-store order', async () => {
    expect(await deliver(true)).not.toHaveBeenCalled();
  });

  it('still generates for every other order', async () => {
    expect(await deliver(false)).toHaveBeenCalledWith('o1');
  });
});
