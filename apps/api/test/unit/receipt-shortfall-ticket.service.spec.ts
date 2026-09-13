import { ActorType, GoodsReceiptStatus, NotificationCategory, TicketType } from '@skydrop/db';
import { ReceiptShortfallTicketService } from '../../src/modules/inventory-receipt/services/receipt-shortfall-ticket.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { TicketService } from '../../src/modules/ticket/services/ticket.service';
import type { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';
import type { SellerNotificationPreferenceResolver } from '../../src/modules/seller-notification-preference/services/seller-notification-preference-resolver.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';

type AnyArgs = Record<string, unknown>;

const RECEIPT_ID = 'gr-1';

/** Production's GR-2026-08-0004, as the loader selects it. */
function receiptRow(over: Partial<AnyArgs> = {}): AnyArgs {
  return {
    id: RECEIPT_ID,
    sellerId: 'seller-1',
    receiptNumber: 'GR-2026-08-0004',
    status: GoodsReceiptStatus.COMPLETED,
    deletedAt: null,
    forwardedWithoutCount: false,
    receivedAt: new Date('2026-08-19T15:16:34.199Z'),
    dispatchedAt: null,
    warehouse: { code: 'DAC-01', name: 'Dhaka Intake', timezone: 'Asia/Dhaka' },
    consignment: {
      consignmentNumber: 'CN-2026-08-000003',
      receipts: [
        {
          forwardedWithoutCount: false,
          warehouse: { code: 'DAC-01', name: 'Dhaka Intake', timezone: 'Asia/Dhaka' },
        },
      ],
    },
    lines: [
      line('AVIATO-GREE-BLAC', 'Green / Black', 200, 198),
      line('AVIATO-BLAC-BLAC', 'Black / Black', 100, 103),
    ],
    ...over,
  };
}

function line(sku: string, label: string, expected: number, received: number, damaged = 0) {
  return {
    expectedQty: expected,
    receivedQty: received,
    damagedQty: damaged,
    variant: { skuCode: sku, variantLabel: label, product: { name: 'Aviator OG Sunglass' } },
  };
}

function make(opts: { row?: AnyArgs | null; told?: number; existingTicket?: AnyArgs | null } = {}) {
  const goodsReceiptFindUnique = jest.fn(async () =>
    opts.row === undefined ? receiptRow() : opts.row,
  );
  const goodsReceiptFindMany = jest.fn(async () => [{ id: RECEIPT_ID }]);
  const notificationLogCount = jest.fn(async () => opts.told ?? 0);
  const ticketFindUnique = jest.fn(async () => opts.existingTicket ?? null);
  const prisma = {
    client: {
      goodsReceipt: { findUnique: goodsReceiptFindUnique, findMany: goodsReceiptFindMany },
      notificationLog: { count: notificationLogCount },
      ticket: { findUnique: ticketFindUnique },
    },
  } as unknown as PrismaService;

  const openOrFind = jest.fn(async (input: AnyArgs) => ({
    ticket: {
      id: 'tk-1',
      ticketNumber: 'TK-2026-000004',
      description: (input.descriptionFor as (n: string) => string)('TK-2026-000004'),
    },
    created: true,
  }));
  const dispatch = jest.fn(async () => ({
    groupId: 'g',
    recipients: 2,
    delivered: 2,
    skipped: 0,
    failures: 0,
  }));
  const resolve = jest.fn(async () => ({ email: true, inApp: true, emailDelayMs: 0 }));
  const auditLog = jest.fn(async () => 'a1');
  const svc = new ReceiptShortfallTicketService(
    prisma,
    { openOrFind } as unknown as TicketService,
    { dispatch } as unknown as NotificationDispatchService,
    { resolve } as unknown as SellerNotificationPreferenceResolver,
    { log: auditLog } as unknown as AuditLogService,
  );
  return { svc, openOrFind, dispatch, auditLog, goodsReceiptFindUnique };
}

describe('ReceiptShortfallTicketService', () => {
  it('a completed short count opens ONE ticket keyed on the receipt, as the system', async () => {
    const { svc, openOrFind } = make();
    await svc.afterCompletion(RECEIPT_ID);

    expect(openOrFind).toHaveBeenCalledTimes(1);
    const [input, actor] = openOrFind.mock.calls[0] as unknown as [AnyArgs, AnyArgs];
    expect(input).toMatchObject({
      ticketType: TicketType.RECEIPT_SHORTFALL,
      sellerId: 'seller-1',
      goodsReceiptId: RECEIPT_ID,
      subject: 'CN-2026-08-000003: 2 short at DAC-01',
    });
    // The opening message names its own ticket number.
    const description = (input.descriptionFor as (n: string) => string)('TK-2026-000004');
    expect(description).toContain('Ticket TK-2026-000004');
    expect(description).toContain('declared 200 · counted 198 · damaged 0 · short 2');
    expect(description).not.toContain('AVIATO-BLAC-BLAC');
    expect(actor).toEqual({ type: ActorType.SYSTEM });
  });

  it('the surplus on the same receipt is a notice to the people who see inbound stock', async () => {
    const { svc, dispatch } = make();
    await svc.afterCompletion(RECEIPT_ID);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'inventory.receipt_surplus',
        category: NotificationCategory.INFORMATIONAL,
        title: '3 more AVIATO-BLAC-BLAC than declared arrived at Dhaka Intake',
        audience: [{ kind: 'SELLER_PERMISSION', sellerId: 'seller-1', permission: 'inbound.view' }],
        eventId: `receipt_surplus:${RECEIPT_ID}`,
      }),
    );
  });

  it('a count that is only OVER opens no ticket', async () => {
    const { svc, openOrFind, dispatch } = make({
      row: receiptRow({ lines: [line('AVIATO-BLAC-BLAC', 'Black / Black', 100, 103)] }),
    });
    await svc.afterCompletion(RECEIPT_ID);
    expect(openOrFind).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('a matching count does nothing at all', async () => {
    const { svc, openOrFind, dispatch } = make({
      row: receiptRow({ lines: [line('AVIATO-BLAC-BLAC', 'Black / Black', 100, 100)] }),
    });
    await svc.afterCompletion(RECEIPT_ID);
    expect(openOrFind).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a Dhaka stop that forwarded without counting has nothing to be short of', async () => {
    const { svc, openOrFind } = make({ row: receiptRow({ forwardedWithoutCount: true }) });
    await svc.afterCompletion(RECEIPT_ID);
    expect(openOrFind).not.toHaveBeenCalled();
  });

  it('the India leg after a COUNTED Dhaka stop is a loss in transit', async () => {
    const { svc, openOrFind } = make({
      row: receiptRow({
        receiptNumber: 'CN-2026-08-000003-000003',
        dispatchedAt: new Date('2026-08-19T17:48:05Z'),
        warehouse: { code: 'BLR-01', name: 'Bangalore', timezone: 'Asia/Kolkata' },
        lines: [line('AVIATO-GREE-BLAC', 'Green / Black', 198, 196)],
      }),
    });
    await svc.afterCompletion(RECEIPT_ID);
    const input = (openOrFind.mock.calls[0] as unknown as [AnyArgs])[0];
    const msg = (input.descriptionFor as (n: string) => string)('TK-2026-000005');
    expect(msg).toContain('between DAC-01 (Dhaka Intake) and BLR-01 (Bangalore)');
    expect(msg).toContain('sent 198');
  });

  it('...but after a Dhaka stop that forwarded UNOPENED, India was the first count', async () => {
    const { svc, openOrFind } = make({
      row: receiptRow({
        dispatchedAt: new Date('2026-08-19T17:48:05Z'),
        consignment: {
          consignmentNumber: 'CN-2026-08-000003',
          receipts: [
            {
              forwardedWithoutCount: true,
              warehouse: { code: 'DAC-01', name: 'Dhaka Intake', timezone: 'Asia/Dhaka' },
            },
          ],
        },
      }),
    });
    await svc.afterCompletion(RECEIPT_ID);
    const input = (openOrFind.mock.calls[0] as unknown as [AnyArgs])[0];
    const msg = (input.descriptionFor as (n: string) => string)('TK-2026-000006');
    expect(msg).toContain('between you and our first warehouse');
  });

  it('never throws out of a completion — it audits HIGH instead', async () => {
    const { svc, openOrFind, auditLog } = make();
    openOrFind.mockRejectedValueOnce(new Error('ticket table locked'));
    await expect(svc.afterCompletion(RECEIPT_ID)).resolves.toBeUndefined();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'inventory.receipt_shortfall.not_raised',
        severity: 'HIGH',
        entityId: RECEIPT_ID,
      }),
    );
  });

  it('a surplus already told is not told again', async () => {
    const { svc, dispatch } = make({ told: 1 });
    await svc.afterCompletion(RECEIPT_ID);
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('backfill', () => {
    it('a dry run writes nothing and shows exactly what it would write', async () => {
      const { svc, openOrFind, dispatch, auditLog } = make();
      const report = await svc.backfill({ dryRun: true, staffId: 'staff-1' });

      expect(openOrFind).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(report).toMatchObject({ dryRun: true, considered: 1, ticketsOpened: 0 });
      expect(report.receipts).toHaveLength(1);
      const row = report.receipts[0];
      expect(row).toMatchObject({
        receiptNumber: 'GR-2026-08-0004',
        consignmentNumber: 'CN-2026-08-000003',
        leg: 'SELLER_TO_FIRST_WAREHOUSE',
        shortUnits: 2,
        surplusUnits: 3,
        ticket: 'WOULD_OPEN',
        surplus: 'WOULD_TELL',
      });
      expect(row?.preview?.ticketMessage).toContain(
        'We opened this ticket for you because goods receipt GR-2026-08-0004 came up short.',
      );
      expect(row?.preview?.surplusTitle).toBe(
        '3 more AVIATO-BLAC-BLAC than declared arrived at Dhaka Intake',
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'inventory.receipt_shortfall.backfill',
          entityId: null,
          severity: 'LOW',
        }),
      );
    });

    it('a dry run over a receipt already ticketed says so', async () => {
      const { svc } = make({
        existingTicket: { id: 'tk-9', ticketNumber: 'TK-2026-000004' },
        told: 1,
      });
      const report = await svc.backfill({ dryRun: true, staffId: 'staff-1' });
      expect(report.receipts[0]).toMatchObject({
        ticket: 'EXISTS',
        ticketNumber: 'TK-2026-000004',
        surplus: 'ALREADY_TOLD',
      });
    });

    it('a real run opens the ticket as the operator and sends the notice, audited HIGH', async () => {
      const { svc, openOrFind, dispatch, auditLog } = make();
      const report = await svc.backfill({ dryRun: false, staffId: 'staff-1' });
      const [, actor] = openOrFind.mock.calls[0] as unknown as [AnyArgs, AnyArgs];
      expect(actor).toEqual({ type: ActorType.STAFF, staffId: 'staff-1' });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(report).toMatchObject({ ticketsOpened: 1, surplusNoticesSent: 1 });
      expect(report.receipts[0]).toMatchObject({
        ticket: 'OPENED',
        ticketNumber: 'TK-2026-000004',
      });
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ severity: 'HIGH' }));
    });
  });
});
