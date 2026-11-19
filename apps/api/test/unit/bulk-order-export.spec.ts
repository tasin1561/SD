import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@skydrop/db';

import { BulkOrderIdsDto } from '../../src/common/bulk/bulk-order.dto';
import { csvCell, csvLine, istDay, istStamp } from '../../src/common/bulk/csv';
import { BulkOrderExportService } from '../../src/modules/bulk-order-actions/services/bulk-order-export.service';
import { SellerBulkExportDto } from '../../src/modules/order/dto/bulk-order-export.dto';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const id = (n: number): string => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

interface FakeOrder {
  id: string;
  sellerId: string;
  orderNumber: string;
  customer: string;
}

function order(n: number, sellerId: string, customer = 'Asha'): FakeOrder {
  return { id: id(n), sellerId, orderNumber: `SD-${n}`, customer };
}

/** A prisma whose order.findMany really applies the `scope` it is handed. */
function makePrisma(rows: FakeOrder[]): { prisma: PrismaService; wheres: unknown[] } {
  const wheres: unknown[] = [];
  const client = {
    order: {
      findMany: jest.fn(
        (args: {
          where: { AND: [{ sellerId?: string }, { id: { in: string[] } }] };
        }): unknown[] => {
          wheres.push(args.where);
          const [scope, byId] = args.where.AND;
          return rows
            .filter((r) => byId.id.in.includes(r.id))
            .filter((r) => scope.sellerId === undefined || r.sellerId === scope.sellerId)
            .map((r) => ({
              id: r.id,
              orderNumber: r.orderNumber,
              sellerOrderRef: '=HYPERLINK("http://x")',
              status: 'CONFIRMED',
              source: 'MANUAL',
              placedAt: new Date('2026-11-19T08:30:00Z'),
              recipientName: r.customer,
              recipientPhoneE164: '+919876543210',
              recipientPostalCode: '700001',
              recipientCity: 'Kolkata',
              recipientStateProvince: 'WB',
              paymentMode: 'COD',
              codAmountInr: new Prisma.Decimal('1499.5'),
              storeNameSnapshot: 'Main shop',
              seller: { companyName: 'Acme Traders' },
            }));
        },
      ),
    },
    orderShipment: { findMany: jest.fn(() => []) },
    trackingEvent: { findMany: jest.fn(() => []) },
  };
  return { prisma: { client } as unknown as PrismaService, wheres };
}

describe('bulk CSV helpers', () => {
  it('prefixes a formula-looking cell and leaves ordinary text alone', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('Asha')).toBe('Asha');
  });

  it('does not corrupt a bare international phone number', () => {
    expect(csvCell('+919876543210')).toBe('+919876543210');
  });

  it('quotes commas, quotes and newlines, and doubles inner quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    // Injection and quoting together: the apostrophe goes inside the quotes.
    expect(csvCell('=A,B')).toBe('"\'=A,B"');
    expect(csvLine(['x', null, undefined, 3])).toBe('x,,,3');
  });

  it('renders India time', () => {
    expect(istStamp(new Date('2026-11-19T20:00:00Z'))).toBe('2026-11-20 01:30:00');
    expect(istDay(new Date('2026-11-19T20:00:00Z'))).toBe('2026-11-20');
    expect(istStamp(null)).toBe('');
  });
});

describe('BulkOrderExportService', () => {
  it('reads rows under the caller scope; a foreign id is absent and counted', async () => {
    const { prisma, wheres } = makePrisma([order(1, 'sellerA'), order(2, 'sellerB')]);
    const svc = new BulkOrderExportService(prisma);
    const out = await svc.build({
      audience: 'CLIENT',
      scope: { sellerId: 'sellerA' },
      orderIds: [id(1), id(2)],
      now: new Date('2026-11-19T08:30:00Z'),
    });
    expect(out.rowCount).toBe(1);
    expect(out.missingCount).toBe(1);
    expect(out.csv).toContain('SD-1');
    expect(out.csv).not.toContain('SD-2');
    expect(out.fileName).toBe('skydrop-orders-2026-11-19.csv');
    // The scope is IN the query, not a filter afterwards.
    expect((wheres[0] as { AND: unknown[] }).AND[0]).toEqual({ sellerId: 'sellerA' });
  });

  it('writes the BOM, CRLF lines, IST time and a neutralised formula in the ref', async () => {
    const { prisma } = makePrisma([order(1, 'sellerA', '@evil')]);
    const out = await new BulkOrderExportService(prisma).build({
      audience: 'CLIENT',
      scope: { sellerId: 'sellerA' },
      orderIds: [id(1)],
    });
    expect(out.csv.startsWith('﻿')).toBe(true);
    const lines = out.csv.split('\r\n');
    expect(lines).toHaveLength(3); // head, one row, trailing empty
    expect(lines[1]).toContain('2026-11-19 14:00:00'); // 08:30Z -> 14:00 IST
    expect(lines[1]).toContain("'@evil");
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[1]).toContain('1499.50');
    expect(lines[1]).toContain('+919876543210');
  });

  it('gives each audience its own columns; a store gets no client / source / store money columns', async () => {
    const { prisma } = makePrisma([order(1, 'sellerA')]);
    const svc = new BulkOrderExportService(prisma);
    const head = async (audience: 'CLIENT' | 'STORE' | 'ADMIN'): Promise<string[]> => {
      const out = await svc.build({ audience, scope: {}, orderIds: [id(1)] });
      return (out.csv.replace('﻿', '').split('\r\n')[0] ?? '').split(',');
    };
    const store = await head('STORE');
    const client = await head('CLIENT');
    const admin = await head('ADMIN');
    expect(store).toHaveLength(15);
    expect(client).toEqual([...store, 'Source', 'Store']);
    expect(admin).toEqual([...store, 'Client', 'Source', 'Store']);

    const storeCsv = (await svc.build({ audience: 'STORE', scope: {}, orderIds: [id(1)] })).csv;
    // The seller's company and the seller-side shopfront never reach a store.
    expect(storeCsv).not.toContain('Acme Traders');
    expect(storeCsv).not.toContain('Main shop');
    const adminCsv = (await svc.build({ audience: 'ADMIN', scope: {}, orderIds: [id(1)] })).csv;
    expect(adminCsv).toContain('Acme Traders');
  });

  describe('collectIds', () => {
    const svc = new BulkOrderExportService(makePrisma([]).prisma);

    it('refuses both and neither of orderIds / filter', async () => {
      const list = jest.fn();
      await expect(svc.collectIds({}, list)).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.collectIds({ orderIds: [id(1)], filter: {} }, list)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(list).not.toHaveBeenCalled();
    });

    it('refuses more than 5000 ids with 400 EXPORT_TOO_LARGE', async () => {
      const many = Array.from({ length: 5001 }, (_, i) => id(i + 1));
      await expect(svc.collectIds({ orderIds: many }, jest.fn())).rejects.toMatchObject({
        response: { code: 'EXPORT_TOO_LARGE' },
      });
      const ok = Array.from({ length: 5000 }, (_, i) => id(i + 1));
      await expect(svc.collectIds({ orderIds: ok }, jest.fn())).resolves.toHaveLength(5000);
    });

    it('refuses a filter that matches more than 5000, before reading them all', async () => {
      const list = jest.fn().mockResolvedValue({ items: [{ id: id(1) }], total: 5001 });
      await expect(svc.collectIds({ filter: {} }, list)).rejects.toMatchObject({
        response: { code: 'EXPORT_TOO_LARGE' },
      });
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('walks the list query page by page and ignores a page the caller sent', async () => {
      const total = 230;
      const all = Array.from({ length: total }, (_, i) => ({ id: id(i + 1) }));
      const list = jest.fn(
        (f: { page: number; pageSize: number }): Promise<{ items: typeof all; total: number }> =>
          Promise.resolve({
            items: all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize),
            total,
          }),
      );
      const ids = await svc.collectIds({ filter: { page: 9, status: 'X' } as never }, list);
      expect(ids).toHaveLength(230);
      expect(list).toHaveBeenCalledTimes(3);
      expect(list.mock.calls[0]?.[0]).toMatchObject({ page: 1, pageSize: 100, status: 'X' });
    });
  });
});

describe('bulk selection DTOs', () => {
  it('caps a hand-picked selection at 200 and at least 1', async () => {
    const mk = (n: number): BulkOrderIdsDto =>
      plainToInstance(BulkOrderIdsDto, {
        orderIds: Array.from({ length: n }, (_, i) => id(i + 1)),
      });
    expect(await validate(mk(200))).toHaveLength(0);
    expect(await validate(mk(201))).not.toHaveLength(0);
    expect(await validate(mk(0))).not.toHaveLength(0);
  });

  it('caps an export selection at 5000 ids', async () => {
    const mk = (n: number): SellerBulkExportDto =>
      plainToInstance(SellerBulkExportDto, {
        orderIds: Array.from({ length: n }, (_, i) => id(i + 1)),
      });
    expect(await validate(mk(5000))).toHaveLength(0);
    expect(await validate(mk(5001))).not.toHaveLength(0);
  });
});
