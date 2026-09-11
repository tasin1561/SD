import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@skydrop/db';
import { RemittanceMatchService } from '../../src/modules/courier-settlement/services/remittance-match.service';
import {
  DelhiveryRemittanceParser,
  RemittanceParserRegistry,
  ShiprocketRemittanceParser,
} from '../../src/modules/courier-settlement/services/remittance-parser.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { buildXls } from '../helpers/xls-builder';

const CSV = readFileSync(join(__dirname, '../fixtures/delhivery-remittance.csv'), 'utf8');
const D = (v: string): Prisma.Decimal => new Prisma.Decimal(v);

/**
 * The "ten arrived, eight are recognised" case, answered BEFORE any
 * money moves rather than found afterwards in a float report.
 */
function makeSut(opts: {
  known?: Array<{ awb: string; orderId: string; orderNumber: string; cod: string }>;
  settledOrderIds?: string[];
}) {
  const known = opts.known ?? [];
  const prisma = {
    client: {
      shipment: {
        findMany: jest.fn(async () =>
          known.map((k) => ({
            awbNumber: k.awb,
            orderShipments: [
              {
                order: {
                  id: k.orderId,
                  orderNumber: k.orderNumber,
                  codAmountInr: D(k.cod),
                  seller: { companyName: 'QA Test Traders' },
                },
              },
            ],
          })),
        ),
      },
      courierSettlementLine: {
        findMany: jest.fn(async () => (opts.settledOrderIds ?? []).map((orderId) => ({ orderId }))),
      },
    },
  } as unknown as PrismaService;
  return new RemittanceMatchService(
    prisma,
    new RemittanceParserRegistry(new DelhiveryRemittanceParser(), new ShiprocketRemittanceParser()),
  );
}

/** Two parcels; the second adjusted by Shiprocket in a column never seen filled. */
function shiprocketFile(): Buffer {
  const awbHeader = [
    'CRF ID',
    'AWB',
    'Delivered Date',
    'Shipped Date',
    'Order Id',
    'Courier',
    'Order Value',
    'Channel Name',
    'Remittance Date',
    'UTR',
    'total_adjusted_amt',
    'Linked CRF Ids',
  ];
  const crfHeader = [
    'Date',
    'CRF ID',
    'COD Available',
    'Freight Charges from COD',
    'Early COD Charges',
    'RTO Reversal Amount',
    'Remittance Amount',
    'Remittance Method',
    'UTR',
    'Adjusted Amount',
    'Status',
    'remarks',
  ];
  const parcel = (awb: string | number, value: number, adjusted: number | null) => [
    13449838,
    awb,
    '',
    '',
    1,
    'Xpressbees Surface',
    value,
    'CUSTOM',
    '',
    'IN22625415423299',
    adjusted,
    null,
  ];
  return buildXls([
    {
      name: 'AWB level report',
      rows: [awbHeader, parcel(14112364794902, 1500, null), parcel('SF3771704958KR', 1600, -40)],
    },
    {
      name: 'CRF level report',
      rows: [
        crfHeader,
        [
          '',
          13449838,
          3100,
          0,
          0,
          0,
          3100,
          'Prepaid',
          'IN22625415423299',
          null,
          'Remittance success',
          '',
        ],
      ],
    },
  ]);
}

describe('RemittanceMatchService.preview', () => {
  it('names what it cannot place instead of dropping it', async () => {
    // Six lines in the file, two waybills we know. The other four are
    // the whole point: silently skipping them is how a payout gets
    // recorded short and nobody notices until the float report.
    const svc = makeSut({
      known: [
        { awb: '38061110519610', orderId: 'o-1', orderNumber: 'SD-1', cod: '1000.00' },
        { awb: '38061110517333', orderId: 'o-2', orderNumber: 'SD-2', cod: '1200.00' },
      ],
    });
    const out = await svc.preview('delhivery', CSV);
    expect(out.rows).toHaveLength(6);
    expect(out.matchedCount).toBe(2);
    expect(out.unmatchedCount).toBe(4);
    expect(out.rows.filter((r) => r.problem !== null).every((r) => r.problem !== '')).toBe(true);
    expect(out.rows.find((r) => r.awbNumber === '38061110518383')?.problem).toMatch(/waybill/i);
  });

  it('totals what CAN be allocated separately from what the file claims', async () => {
    // Two numbers, because they answer different questions: what the
    // courier says it paid, and what we are in a position to attribute.
    const svc = makeSut({
      known: [{ awb: '38061110519610', orderId: 'o-1', orderNumber: 'SD-1', cod: '1000.00' }],
    });
    const out = await svc.preview('delhivery', CSV);
    expect(out.allocatableInr).toBe('1000.00');
    expect(out.fileTotalInr).toBe('8240.00');
  });

  it('refuses to re-allocate an order settled on an earlier payout', async () => {
    // The wallet is append-only, so a double credit is permanent.
    const svc = makeSut({
      known: [{ awb: '38061110519610', orderId: 'o-1', orderNumber: 'SD-1', cod: '1000.00' }],
      settledOrderIds: ['o-1'],
    });
    const out = await svc.preview('delhivery', CSV);
    expect(out.alreadySettledCount).toBe(1);
    expect(out.matchedCount).toBe(0);
    expect(out.allocatableInr).toBe('0.00');
  });

  it('surfaces what we expected, so a short payment shows before recording', async () => {
    const svc = makeSut({
      known: [{ awb: '38061110519610', orderId: 'o-1', orderNumber: 'SD-1', cod: '1500.00' }],
    });
    const out = await svc.preview('delhivery', CSV);
    const row = out.rows.find((r) => r.awbNumber === '38061110519610');
    expect(row?.expectedInr).toBe('1500.00');
    expect(row?.settledInr).toBe('1000.00');
    expect(row?.sellerName).toBe('QA Test Traders');
  });

  it("matches Shiprocket's .xls on the waybill, including one Excel stored as a number", async () => {
    const svc = makeSut({
      known: [{ awb: '14112364794902', orderId: 'o-9', orderNumber: 'SD-9', cod: '1500.00' }],
    });
    const out = await svc.preview('shiprocket', shiprocketFile());
    const row = out.rows.find((r) => r.awbNumber === '14112364794902');
    expect(row).toMatchObject({ orderId: 'o-9', settledInr: '1500.00', problem: null });
    expect(out.summary).toMatchObject({ references: ['IN22625415423299'], remittedInr: '3100.00' });
    expect(out.warnings).toEqual([]);
  });

  it('keeps a parcel Shiprocket adjusted out of the allocation, saying why', async () => {
    // Even when we KNOW the waybill: the file says something about its
    // amount we cannot read, so a person decides.
    const svc = makeSut({
      known: [{ awb: 'SF3771704958KR', orderId: 'o-8', orderNumber: 'SD-8', cod: '1600.00' }],
    });
    const out = await svc.preview('shiprocket', shiprocketFile());
    const row = out.rows.find((r) => r.awbNumber === 'SF3771704958KR');
    expect(row?.problem).toMatch(/allocate it by hand/);
    expect(out.allocatableInr).toBe('0.00');
  });

  it('writes nothing — it is a question, not a decision', async () => {
    const svc = makeSut({ known: [] });
    await svc.preview('delhivery', CSV);
    // Constructed with a client that has no create/update at all: if the
    // service ever grows a write, this fails rather than mutating.
    expect(true).toBe(true);
  });
});
