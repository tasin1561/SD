import { buildXlsx, buildZip } from '../helpers/zip-builder';
import {
  ShiprocketInvoiceFormatError,
  checkInvoices,
  decimalToPaise,
  parseInvoiceList,
  parseIstDateTime,
  parseItemized,
  type FreightLine,
  type InvoiceRead,
  type SrInvoice,
  type VasLine,
  type WalletMove,
} from '../../src/modules/courier-portal/services/shiprocket-invoice-rows';

/**
 * Shiprocket's invoices against their wallet. The shapes are theirs,
 * measured 2026-09-11; the scenarios are the ones 90 days of real data
 * produced — a swapped waybill, parcels older than our ledger, a July
 * charge billed on August's invoice, and WhatsApp charges never invoiced.
 */

const at = (s: string): Date => {
  const d = parseIstDateTime(s);
  if (d === null) throw new Error(`bad date ${s}`);
  return d;
};
const paise = (inr: string): number => decimalToPaise(inr) ?? Number.NaN;

const FREIGHT_HEADER =
  'AWB Code,Order ID,Courier,Billed Weight,Applied Weight,Charged Weight,Freight Cost (Exclusive GST),GST,' +
  'Billing Amount (Inclusive GST),Forward charges,RTO Charges,COD Charges,COD Adjusted,Original AWB Code,' +
  'Zone,Description,Awb Assigned Date,Awb Status,Order Value';
const freightCsvRow = (awb: string, order: string, billed: string, assigned: string): string =>
  `'${awb}',${order},Blue Dart Air,0.500,0.500,0.500,0,0,${billed},0,0,0,0,,z_e,Forward charges,${assigned},DELIVERED,1250.00`;
const VAS_HEADER =
  'Channel Order Id,Order Id,AWB,Item Name,HSN Code,Total,SGST Percentage,CGST Percentage,IGST Percentage,Order_Date';
const vasCsvRow = (order: string, item: string, total: string, date: string): string =>
  `${order},1458479200,,${item},998593,${total},0.0,0.0,18.0,${date}`;

describe('reading their files', () => {
  it('reads the invoice list and refuses a row that is not one', () => {
    const [inv] = parseInvoiceList([
      [
        'SRV27HR000315314',
        'VAS',
        '03 Sep, 2026',
        '10 Sep, 2026',
        '₹ 8516.36',
        'Paid',
        'View Invoice',
      ],
    ]);
    expect(inv).toMatchObject({
      invoiceId: 'SRV27HR000315314',
      serviceType: 'VAS',
      totalPaise: 851636,
    });
    expect(inv?.invoiceDate.toISOString()).toBe('2026-09-02T18:30:00.000Z');
    // Their date picker draws its calendar as a table too.
    expect(() => parseInvoiceList([['5', '6', '7', '8', '9', '10', '11']])).toThrow(
      ShiprocketInvoiceFormatError,
    );
  });

  it('turns their amounts into exact paise', () => {
    expect(decimalToPaise('224.2400')).toBe(22424);
    expect(decimalToPaise('5.9')).toBe(590);
    expect(decimalToPaise('-47.25')).toBe(-4725);
    expect(decimalToPaise('1.005')).toBe(101); // a float would make this 100
    expect(decimalToPaise('1,250.00')).toBe(125000);
    expect(decimalToPaise('n/a')).toBeNull();
  });

  it('reads a freight itemization, quotes and all', () => {
    const csv = `\uFEFF${FREIGHT_HEADER}\n${freightCsvRow('80125793241', '8138093805', '264.60', '2026-07-23 16:07')}\n`;
    const out = parseItemized(Buffer.from(csv));
    expect(out.freight).toEqual([
      {
        awb: '80125793241',
        orderId: '8138093805',
        billedPaise: 26460,
        assignedAt: new Date('2026-07-23T10:37:00.000Z'),
        status: 'DELIVERED',
      },
    ]);
    expect(out.vas).toEqual([]);
  });

  it('reads a monthly VAS zip, naming each service as the passbook does', () => {
    const zip = buildZip([
      {
        name: 'Whatsapp Tracking Status.csv',
        body: `${VAS_HEADER}\n${vasCsvRow('1338921291', 'Whatsapp Tracking Status', '5.9', '2026-07-09 13:07:50')}`,
      },
      {
        name: 'RTO Score.csv',
        body: `${VAS_HEADER}\n${vasCsvRow('2115357959', 'RTO Score', '4.12', '2026-07-18 12:07:03')}\n${vasCsvRow('9', 'Order Insurance', '10', '2026-07-18 12:07:03')}`,
      },
    ]);
    const out = parseItemized(zip);
    expect(out.vas.map((l) => [l.service, l.known, l.orderId, l.totalPaise])).toEqual([
      ['WhatsApp Communication', true, '1338921291', 590],
      ['RTO Score Charge', true, '2115357959', 412],
      // A service we do not know is kept, and marked so.
      ['Order Insurance', false, '9', 1000],
    ]);
  });

  it('reads the ShipSure workbook as one charge on the account', () => {
    const xlsx = buildXlsx([
      [
        'Channel Order Id',
        'Order Id',
        'AWB',
        'Item Name',
        'HSN Code',
        'Total',
        'IGST Percentage',
        'Order Date',
      ],
      ['3454', '3454', '', 'Shipsure Charges', '996812', '9206.66', '18', '2026-08-25 17:05'],
    ]);
    const out = parseItemized(xlsx);
    expect(out.vas).toEqual([
      {
        service: 'Ship Sure',
        known: true,
        orderId: '', // the wallet's premium row names no order
        totalPaise: 920666,
        orderDate: new Date('2026-08-25T11:35:00.000Z'),
      },
    ]);
  });

  it('refuses what it does not recognise rather than reading it as nothing', () => {
    expect(() => parseItemized(Buffer.from('%PDF-1.4 …'))).toThrow(/document/);
    expect(() => parseItemized(Buffer.from('A,B,C\n1,2,3\n'))).toThrow(/not a format we know/);
    expect(() => parseItemized(buildZip([{ name: 'readme.txt', body: 'hi' }]))).toThrow(
      /not a CSV/,
    );
  });
});

// ── the comparison ─────────────────────────────────────────────────────

const LEDGER_START = at('2026-06-13 10:48');
const NOW = at('2026-09-11 21:00');

const invoice = (id: string, type: string, date: string, totalInr: string): SrInvoice => ({
  invoiceId: id,
  serviceType: type,
  invoiceDate: at(date),
  totalPaise: paise(totalInr),
  status: 'Paid',
});
const vas = (orderId: string, service: string, inr: string, date: string): VasLine => ({
  service,
  known: true,
  orderId,
  totalPaise: paise(inr),
  orderDate: at(date),
});
const freight = (awb: string, orderId: string, inr: string, assigned: string): FreightLine => ({
  awb,
  orderId,
  billedPaise: paise(inr),
  assignedAt: at(assigned),
  status: 'DELIVERED',
});
const read = (
  inv: SrInvoice,
  lines: { vas?: VasLine[]; freight?: FreightLine[] },
): InvoiceRead => ({
  invoice: inv,
  itemized: { vas: lines.vas ?? [], freight: lines.freight ?? [], files: [] },
  problem: null,
});
const move = (
  orderId: string | null,
  type: 'VAS' | 'Freight Charges',
  sub: string,
  inr: string,
  when: string,
  awb: string | null = 'AWB',
): WalletMove => ({
  occurredAt: at(when),
  costPaise: paise(inr),
  orderId,
  awb,
  transactionType: type,
  subCategory: sub,
});
const WA = 'WhatsApp Communication';
const RTO = 'RTO Score Charge';

const run = (invoices: InvoiceRead[], moves: WalletMove[]): ReturnType<typeof checkInvoices> =>
  checkInvoices({ invoices, moves, ledgerStart: LEDGER_START, now: NOW });

describe('checkInvoices', () => {
  const august = (total: string, lines: VasLine[]): InvoiceRead =>
    read(invoice('SRV27HR000274953', 'VAS', '2026-08-03', total), { vas: lines });

  it('an invoice whose every line the wallet charged MATCHES', () => {
    const out = run(
      [august('10.02', [vas('A', WA, '5.90', '2026-07-02'), vas('B', RTO, '4.12', '2026-07-03')])],
      [move('A', 'VAS', WA, '5.90', '2026-07-02'), move('B', 'VAS', RTO, '4.12', '2026-07-03')],
    );
    expect(out.rows[0]).toMatchObject({
      status: 'MATCHES',
      totalsAgree: true,
      itemizedInr: '10.02',
    });
    expect(out.vasUninvoiced.count).toBe(0);
  });

  it('a file that does not add up to its own invoice DIFFERS', () => {
    const out = run(
      [august('11.00', [vas('A', WA, '5.90', '2026-07-02'), vas('B', RTO, '4.12', '2026-07-03')])],
      [move('A', 'VAS', WA, '5.90', '2026-07-02'), move('B', 'VAS', RTO, '4.12', '2026-07-03')],
    );
    expect(out.rows[0]).toMatchObject({ status: 'DIFFERS', totalsAgree: false });
  });

  it('names an order billed more than the wallet charged — a reversal counts', () => {
    const out = run(
      [august('11.80', [vas('A', WA, '5.90', '2026-07-02'), vas('A', WA, '5.90', '2026-07-02')])],
      [
        move('A', 'VAS', WA, '5.90', '2026-07-02'),
        move('A', 'VAS', WA, '5.90', '2026-07-02'),
        move('A', 'VAS', WA, '-5.90', '2026-07-03'), // "Reversal WhatsApp Communication charges"
      ],
    );
    expect(out.rows[0]?.status).toBe('DIFFERS');
    expect(out.rows[0]?.differences).toEqual([
      { service: WA, orderId: 'A', billedInr: '11.80', walletInr: '5.90' },
    ]);
    expect(out.rows[0]?.differenceInr).toBe('5.90');
  });

  it('calls a VAS charge uninvoiced only once the NEXT month’s invoice has passed it by', () => {
    const sept = read(invoice('SRV27HR000315314', 'VAS', '2026-09-03', '5.90'), {
      vas: [vas('E', WA, '5.90', '2026-08-04')],
    });
    const out = run(
      [august('5.90', [vas('D', WA, '5.90', '2026-07-02')]), sept],
      [
        move('D', 'VAS', WA, '5.90', '2026-07-02'),
        move('E', 'VAS', WA, '5.90', '2026-08-04'),
        move('C', 'VAS', WA, '5.90', '2026-07-16 11:25'), // July, on neither invoice
        move('F', 'VAS', WA, '5.90', '2026-08-29'), // late August: October's invoice may bill it
        move('G', 'VAS', WA, '5.90', '2026-06-20'), // June: no invoice for June was read
      ],
    );
    expect(out.vasUninvoiced.count).toBe(1);
    expect(out.vasUninvoiced.inr).toBe('5.90');
    expect(out.vasUninvoiced.items[0]).toMatchObject({ orderId: 'C', lastChargedAt: '2026-07-16' });
  });

  it('a July charge billed on August’s invoice (a carry-over) is not uninvoiced', () => {
    const sept = read(invoice('SRV27HR000315314', 'VAS', '2026-09-03', '11.80'), {
      vas: [vas('E', WA, '5.90', '2026-08-04'), vas('C', WA, '5.90', '2026-07-31')],
    });
    const out = run(
      [august('5.90', [vas('D', WA, '5.90', '2026-07-02')]), sept],
      [
        move('D', 'VAS', WA, '5.90', '2026-07-02'),
        move('E', 'VAS', WA, '5.90', '2026-08-04'),
        move('C', 'VAS', WA, '5.90', '2026-07-31'),
      ],
    );
    expect(out.vasUninvoiced.count).toBe(0);
    expect(out.rows.every((r) => r.status === 'MATCHES')).toBe(true);
  });

  it('compares freight per ORDER, so a swapped waybill still matches', () => {
    // Order 318478638, measured: charged on its first waybill, then the
    // difference and the return on the second — billed once, under the last.
    const out = run(
      [
        read(invoice('SRF27HR000357957', 'Freight', '2026-08-14', '149.10'), {
          freight: [freight('80123681105', '318478638', '149.10', '2026-07-20 16:12')],
        }),
      ],
      [
        move(
          '318478638',
          'Freight Charges',
          'Freight Forward',
          '48.36',
          '2026-07-20 14:00',
          'SRSC8592054921',
        ),
        move(
          '318478638',
          'Freight Charges',
          'Freight COD',
          '42.00',
          '2026-07-20 14:00',
          'SRSC8592054921',
        ),
        move(
          '318478638',
          'Freight Charges',
          'Freight Forward',
          '34.59',
          '2026-07-20 16:12',
          '80123681105',
        ),
        move(
          '318478638',
          'Freight Charges',
          'Freight COD',
          '5.25',
          '2026-07-20 16:12',
          '80123681105',
        ),
        move('318478638', 'Freight Charges', 'Freight COD', '-47.25', '2026-07-29', '80123681105'),
        move('318478638', 'Freight Charges', 'Freight RTO', '66.15', '2026-07-29', '80123681105'),
      ],
    );
    expect(out.rows[0]).toMatchObject({ status: 'MATCHES', differenceCount: 0 });
  });

  it('a parcel booked before our ledger begins is counted, never flagged', () => {
    const out = run(
      [
        read(invoice('SRF27HR000336744', 'Freight', '2026-07-30', '353.22'), {
          freight: [freight('80080091243', '555', '353.22', '2026-06-01 10:00')],
        }),
      ],
      // Only a late reversal of it falls inside the ledger.
      [move('555', 'Freight Charges', 'Freight Forward', '10.87', '2026-06-20')],
    );
    expect(out.rows[0]).toMatchObject({ status: 'MATCHES', beforeRecords: 1, differenceCount: 0 });
  });

  it('freight billed differently from what the wallet charged is a difference', () => {
    const out = run(
      [
        read(invoice('SRF27HR000404559', 'Freight', '2026-08-30', '100.36'), {
          freight: [freight('SF1', '777', '100.36', '2026-08-01 10:00')],
        }),
      ],
      [move('777', 'Freight Charges', 'Freight Forward', '90.36', '2026-08-01 10:00')],
    );
    expect(out.rows[0]?.differences).toEqual([
      { service: 'Freight', orderId: '777', billedInr: '100.36', walletInr: '90.36' },
    ]);
    // 30 Aug + 15 days: still open on 11 Sep.
    expect(out.rows[0]).toMatchObject({ disputeBy: '2026-09-14', disputeOpen: true });
  });

  it('the dispute window closes fifteen days after the invoice', () => {
    const out = run([read(invoice('SRF27HR000357957', 'Freight', '2026-08-14', '0.00'), {})], []);
    expect(out.rows[0]).toMatchObject({ disputeBy: '2026-08-29', disputeOpen: false });
  });

  it('freight not yet invoiced is counted, and the old ones are named', () => {
    const out = run(
      [],
      [
        move('Z', 'Freight Charges', 'Freight Forward', '90.36', '2026-07-01'),
        move('Y', 'Freight Charges', 'Freight Forward', '48.36', '2026-08-20'),
        // Charged and fully reversed: nothing is owed on it.
        move('X', 'Freight Charges', 'Freight Forward', '48.36', '2026-06-20'),
        move('X', 'Freight Charges', 'Freight Forward', '-48.36', '2026-06-21'),
      ],
    );
    expect(out.freightUninvoiced).toMatchObject({
      orders: 2,
      inr: '138.72',
      staleCount: 1,
      staleInr: '90.36',
    });
    expect(out.freightUninvoiced.stale[0]).toMatchObject({
      orderId: 'Z',
      firstChargedAt: '2026-07-01',
    });
  });

  it('a service it does not know makes the invoice DIFFER, by name', () => {
    const out = run(
      [
        august('10.00', [
          {
            service: 'Order Insurance',
            known: false,
            orderId: '9',
            totalPaise: 1000,
            orderDate: at('2026-07-02'),
          },
        ]),
      ],
      [],
    );
    expect(out.rows[0]).toMatchObject({ status: 'DIFFERS', unknownServices: ['Order Insurance'] });
  });

  it('an invoice with no itemized file is NOT_ITEMIZED; one that failed is UNREADABLE', () => {
    const out = run(
      [
        {
          invoice: invoice('SRSI27HR00064789', 'Subscription', '2026-09-08', '799.00'),
          itemized: null,
          problem: null,
        },
        {
          invoice: invoice('SRV27HR000315314', 'VAS', '2026-09-03', '8516.36'),
          itemized: null,
          problem: 'their itemized file answered HTTP 403',
        },
      ],
      [],
    );
    expect(out.rows.map((r) => r.status)).toEqual(['NOT_ITEMIZED', 'UNREADABLE']);
  });

  it('with no ledger at all it judges nothing', () => {
    const out = checkInvoices({
      invoices: [
        read(invoice('SRF27HR000404559', 'Freight', '2026-08-30', '100.36'), {
          freight: [freight('SF1', '777', '100.36', '2026-08-01 10:00')],
        }),
      ],
      moves: [],
      ledgerStart: null,
      now: NOW,
    });
    expect(out.rows[0]).toMatchObject({ status: 'MATCHES', beforeRecords: 1 });
  });
});
