import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@skydrop/db';
import { RemittanceMatchService } from '../../src/modules/courier-settlement/services/remittance-match.service';
import {
  DelhiveryRemittanceParser,
  RemittanceParserRegistry,
} from '../../src/modules/courier-settlement/services/remittance-parser.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

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
    new RemittanceParserRegistry(new DelhiveryRemittanceParser()),
  );
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

  it('writes nothing — it is a question, not a decision', async () => {
    const svc = makeSut({ known: [] });
    await svc.preview('delhivery', CSV);
    // Constructed with a client that has no create/update at all: if the
    // service ever grows a write, this fails rather than mutating.
    expect(true).toBe(true);
  });
});
