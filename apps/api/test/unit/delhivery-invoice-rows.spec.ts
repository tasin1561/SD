import {
  DelhiveryInvoiceFormatError,
  checkDelhiveryInvoices,
  invoiceKindOf,
  istMidnight,
  notesCoverageFrom,
  parseDlvItemized,
  subsetSumming,
  unwrapExcel,
  type DlvCheckInput,
  type DlvInvoice,
  type DlvInvoiceRead,
  type DlvLedgerTxn,
  type DlvNote,
} from '../../src/modules/courier-portal/services/delhivery-invoice-rows';

/**
 * Delhivery's invoices against our stored wallet ledger, on synthetic
 * files shaped like the real ones the probe fetched on 12 Sep 2026 (same
 * headers, same Excel quoting — none of their merchants' data).
 */

const DOMESTIC_HEADER =
  'waybill_num,client,pickup_date,serial_number,origin_center,client_gstin,delhivery_gstin,package_type,product_value,cod_amount,status,charged_weight,zone,payment_mode,payment_mode_type,issuing_bank,charge_POD,charge_COVID,charge_FSC,charge_DL,charge_RTO,charge_DTO,charge_COD,charge_FS,charge_FOV,charge_CCOD,charge_WOD,charge_AIR,charge_pickup,charge_DPH,charge_QC,charge_CWH,charge_E2E,charge_LM,charge_DEMUR,charge_LABEL,charge_REATTEMPT,charge_DOCUMENT,charge_ROV,charge_PEAK,IGST,CGST,SGST/UGST,gross_amount,total_amount,destination_pin,order_id,item_shipped,fpd,atc,mcount,pdd,frd,qc_pass,qc_atc,fuel_base_rate,avg_fuel_rate,fuel_hike,packaging_type,qc,qct,qty,sot';
const VAS_HEADER =
  'message_id,identifier_type,waybill_order_id,client,channel,status_type,status_date,txn_date,category,charge_vas,total_amt,gross_amt,sgst,cgst,serial_number,client_gstin,dlv_gstin';

interface DLine {
  awb: string;
  status?: string;
  pickup?: string;
  gross: string;
  total: string;
}

const xq = (v: string): string => `"=""${v}"""`;

function domesticCsv(serial: string, lines: readonly DLine[]): Buffer {
  const cols = DOMESTIC_HEADER.split(',');
  const body = lines.map((l) =>
    cols
      .map((c) => {
        switch (c) {
          case 'waybill_num':
            return xq(l.awb);
          case 'pickup_date':
            return xq(l.pickup ?? '2026-08-16 11:05:31');
          case 'serial_number':
            return serial;
          case 'status':
            return l.status ?? 'Delivered';
          case 'gross_amount':
            return l.gross;
          case 'total_amount':
            return l.total;
          case 'client':
            return 'TEST-CLIENT';
          default:
            return c.startsWith('charge_') ? '0.00' : '';
        }
      })
      .join(','),
  );
  return Buffer.from([DOMESTIC_HEADER, ...body].join('\n'));
}

function vasCsv(serial: string, lines: readonly { awb: string; gross: string; total: string }[]) {
  const body = lines.map(
    (l, i) =>
      `${xq(`msg-${i}`)},WBN,${l.awb},TEST-CLIENT,whatsapp,E_DL,2026-08-16 00:00:00,2026-08-16 02:21:30,WAYBILL_JOURNEY,${l.gross},${l.total},${l.gross},0.14,0.14,${serial},X,Y`,
  );
  return Buffer.from([VAS_HEADER, ...body].join('\n'));
}

const day = (s: string): Date => istMidnight(s) ?? new Date(NaN);
const inv = (invoiceId: string, serviceType: string, date: string, total: number): DlvInvoice => ({
  invoiceId,
  serviceType,
  kind: invoiceKindOf(serviceType),
  invoiceDate: day(date),
  totalPaise: total,
});
const read = (invoice: DlvInvoice, file: Buffer | null): DlvInvoiceRead => ({
  invoice,
  itemized: file === null ? null : parseDlvItemized(file),
  problem: null,
});

let seq = 0;
const txn = (
  awb: string | null,
  kind: 'DEBIT' | 'CREDIT',
  inr: string,
  iso: string,
  o: { adj?: boolean; detail?: Record<string, unknown> } = {},
): DlvLedgerTxn => {
  seq += 1;
  return {
    txnId: `MTX${seq}`,
    awb,
    kind,
    category: o.adj === true ? 'ADJUSTMENT' : 'PARCEL',
    amountPaise: Math.round(Number(inr) * 100),
    occurredAt: new Date(iso),
    detail: o.detail ?? (o.adj === true ? null : { wbn: awb }),
  };
};
const RECON = { code: 'Freight adjustment debit', stage: 'Settlement based on reconciliation' };
const CLAIM = { notes: 'Claim settled - CMS' };

// W1 plain; W2 the ₹1.18 monthly reconciliation; W3 lost after refund.
const W1 = [txn('W1', 'DEBIT', '58.83', '2026-08-16T06:00:00Z')];
const W2 = [
  txn('W2', 'DEBIT', '72.28', '2026-08-18T06:00:00Z'),
  txn('W2', 'CREDIT', '72.28', '2026-08-22T06:00:00Z'),
  txn('W2', 'DEBIT', '71.10', '2026-08-22T06:00:00Z'),
  txn('W2', 'DEBIT', '72.28', '2026-09-09T06:00:00Z', { adj: true, detail: RECON }),
  txn('W2', 'CREDIT', '71.10', '2026-09-09T06:00:00Z', { adj: true, detail: RECON }),
];
const W3_CLAIM = txn('W3', 'CREDIT', '1499.00', '2026-09-08T06:00:00Z', {
  adj: true,
  detail: CLAIM,
});
const W3 = [
  txn('W3', 'DEBIT', '72.28', '2026-08-12T06:00:00Z'),
  txn('W3', 'DEBIT', '79.49', '2026-08-20T06:00:00Z'),
  txn('W3', 'CREDIT', '72.28', '2026-08-28T06:00:00Z'),
  txn('W3', 'CREDIT', '79.49', '2026-08-28T06:00:00Z'),
  W3_CLAIM,
];

const NOW = new Date('2026-09-12T12:00:00Z');
const input = (o: Partial<DlvCheckInput>): DlvCheckInput => ({
  invoices: [],
  creditNotes: null,
  debitNotes: null,
  notesFrom: null,
  txns: [],
  ledgerStart: new Date('2026-06-13T05:00:00Z'),
  now: NOW,
  disputeDays: 15,
  ...o,
});

describe('reading their files', () => {
  it('unwraps Excel-quoted cells', () => {
    expect(unwrapExcel('="38061110509316"')).toBe('38061110509316');
    expect(unwrapExcel(' 12.50 ')).toBe('12.50');
  });

  it('reads a Domestic transaction list, one line per waybill', () => {
    const it = parseDlvItemized(
      domesticCsv('EPH1', [{ awb: '38061110509316', gross: '49.85', total: '58.83' }]),
    );
    expect(it.kind).toBe('DOMESTIC');
    expect(it.serials).toEqual(['EPH1']);
    expect(it.lines[0]).toMatchObject({
      awb: '38061110509316',
      grossPaise: 4985,
      totalPaise: 5883,
    });
    expect(it.kind === 'DOMESTIC' ? it.lines[0]?.pickupAt?.toISOString() : null).toBe(
      '2026-08-16T05:35:31.000Z',
    );
  });

  it('reads a Communication VAS list, one line per message', () => {
    const it = parseDlvItemized(
      vasCsv('EPVAS1', [
        { awb: 'W1', gross: '1.50', total: '1.77' },
        { awb: 'W2', gross: '1.00', total: '1.18' },
      ]),
    );
    expect(it).toMatchObject({ kind: 'VAS', grossPaise: 250, totalPaise: 295 });
  });

  it('refuses the invoice PDF and a file it does not know', () => {
    expect(() => parseDlvItemized(Buffer.from('%PDF-1.4'))).toThrow(DelhiveryInvoiceFormatError);
    expect(() => parseDlvItemized(Buffer.from('a,b\n1,2'))).toThrow(/columns a \| b/);
  });

  it('tells where a notes list begins from its range control', () => {
    expect(notesCoverageFrom('Date Range : Last 90 Days', NOW)?.toISOString()).toBe(
      new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
    );
    expect(notesCoverageFrom('Date Range : 13 Aug 2026 to 12 Sept 2026', NOW)?.toISOString()).toBe(
      day('2026-08-13').toISOString(),
    );
    expect(notesCoverageFrom(null, NOW)).toBeNull();
  });

  it('finds the fewest movements summing to a note', () => {
    expect(subsetSumming([1000, 129000, 149900], 278900, 1)).toEqual([1, 2]);
    expect(subsetSumming([100, 200], 50, 1)).toBeNull();
  });
});

describe('a Domestic invoice against the wallet', () => {
  it('agrees when every waybill nets to what was billed — reconciliation adjustments included', () => {
    // W2 billed 72.28: the wallet reversed 72.28, charged 71.10, and the
    // monthly recon pair (+72.28 / −71.10) brought it back. Without the
    // adjustments it would read ₹1.18 short.
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH1', 'Domestic', '2026-08-31', 13110),
            domesticCsv('EPH1', [
              { awb: 'W1', gross: '49.85', total: '58.83' },
              { awb: 'W2', gross: '61.25', total: '72.28' },
            ]),
          ),
        ],
        txns: [...W1, ...W2],
      }),
    );
    expect(r.rows[0]).toMatchObject({ status: 'MATCHES', totalsAgree: true, differenceCount: 0 });
  });

  it('allows the line totals a paisa a line — GST is rounded per line in the file, once on the invoice', () => {
    // gross 178.46 × 1.18 = 210.58 (the invoice); the lines total 210.60.
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH1', 'Domestic', '2026-08-31', 21058),
            domesticCsv('EPH1', [
              { awb: 'W1', gross: '49.85', total: '58.83' },
              { awb: 'W2', gross: '61.25', total: '72.28' },
              { awb: 'W3', status: 'RTO', gross: '67.36', total: '79.49' },
            ]),
          ),
        ],
        txns: [...W1, ...W2, ...W3],
      }),
    );
    expect(r.rows[0]?.totalsAgree).toBe(true);
    expect(r.rows[0]?.linesTotalInr).toBe('210.60');
  });

  it('names a lost parcel billed carriage the wallet refunded — and keeps the claim payout out of it', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH1', 'Domestic', '2026-08-31', 21058),
            domesticCsv('EPH1', [
              { awb: 'W1', gross: '49.85', total: '58.83' },
              { awb: 'W2', gross: '61.25', total: '72.28' },
              { awb: 'W3', status: 'RTO', gross: '67.36', total: '79.49' },
            ]),
          ),
        ],
        txns: [...W1, ...W2, ...W3],
      }),
    );
    expect(r.rows[0]?.status).toBe('DIFFERS');
    // Net ₹0, not −₹1,499: the ₹1,499 is the value of the goods.
    expect(r.rows[0]?.differences).toEqual([
      { awb: 'W3', status: 'RTO', billedInr: '79.49', walletInr: '0.00' },
    ]);
    expect(r.rows[0]?.disputeBy).toBe('2026-09-15');
    expect(r.rows[0]?.disputeOpen).toBe(true);
  });

  it('a file that does not add up to its invoice DIFFERS', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH1', 'Domestic', '2026-08-31', 15000),
            domesticCsv('EPH1', [{ awb: 'W1', gross: '49.85', total: '58.83' }]),
          ),
        ],
        txns: W1,
      }),
    );
    expect(r.rows[0]).toMatchObject({ status: 'DIFFERS', totalsAgree: false });
  });

  it('counts, never judges, a waybill booked before the ledger begins', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH1', 'Domestic', '2026-08-31', 6942),
            domesticCsv('EPH1', [
              { awb: 'OLD', pickup: '2026-06-10 10:00:00', gross: '58.83', total: '69.42' },
            ]),
          ),
        ],
        txns: [txn('OLD', 'DEBIT', '12.00', '2026-08-30T06:00:00Z')],
      }),
    );
    expect(r.rows[0]).toMatchObject({ status: 'MATCHES', beforeRecords: 1 });
  });

  it('refuses to compare a file that names another invoice', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [
          read(
            inv('EPH2', 'Domestic', '2026-08-31', 6942),
            domesticCsv('EPH1', [{ awb: 'W1', gross: '58.83', total: '69.42' }]),
          ),
        ],
      }),
    );
    expect(r.rows[0]?.status).toBe('UNREADABLE');
    expect(r.rows[0]?.problem).toMatch(/names invoice EPH1, not EPH2/);
  });
});

describe('waybills charged and never invoiced', () => {
  const W9 = txn('W9', 'DEBIT', '60.00', '2026-08-20T06:00:00Z');
  const EPH_A = read(
    inv('EPH-A', 'Domestic', '2026-08-15', 6942),
    domesticCsv('EPH-A', [{ awb: 'W1', gross: '58.83', total: '69.42' }]),
  );
  const EPH_B = read(inv('EPH-B', 'Domestic', '2026-08-31', 0), domesticCsv('EPH-B', []));
  const EPH_C = read(inv('EPH-C', 'Domestic', '2026-09-15', 0), domesticCsv('EPH-C', []));

  it('is not news while the next invoice may still bill it', () => {
    const r = checkDelhiveryInvoices(input({ invoices: [EPH_A, EPH_B], txns: [W9] }));
    expect(r.uninvoiced).toMatchObject({ count: 0, pendingCount: 1 });
  });

  it('is named once a SECOND later invoice has passed it by', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [EPH_A, EPH_B, EPH_C],
        txns: [W9],
        now: new Date('2026-09-20T12:00:00Z'),
      }),
    );
    expect(r.uninvoiced.count).toBe(1);
    expect(r.uninvoiced.items[0]).toMatchObject({ awb: 'W9', netInr: '60.00' });
  });

  it('is not called uninvoiced while an invoice that may have billed it is unread', () => {
    // Production, 13 Sep 2026: the 15 Aug invoice produced no file, and the
    // waybills it billed read as never invoiced because the read invoices
    // either side of it had passed them by.
    const unread: DlvInvoiceRead = {
      invoice: inv('EPH-U', 'Domestic', '2026-08-31', 6000),
      itemized: null,
      problem: '"Invoice Transaction list" for EPH-U produced no file',
    };
    const EPH_D = read(inv('EPH-D', 'Domestic', '2026-09-30', 0), domesticCsv('EPH-D', []));
    const r = checkDelhiveryInvoices(
      input({
        invoices: [EPH_A, unread, EPH_C, EPH_D],
        txns: [W9],
        now: new Date('2026-10-05T12:00:00Z'),
      }),
    );
    expect(r.uninvoiced).toMatchObject({ count: 0, pendingCount: 1 });
    expect(r.rows.find((x) => x.invoiceId === 'EPH-U')?.status).toBe('UNREADABLE');
  });

  it('counts, never flags, one charged before the ledger begins', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [EPH_A, EPH_B, EPH_C],
        txns: [txn('W8', 'DEBIT', '60.00', '2026-06-12T06:00:00Z')],
        now: new Date('2026-09-20T12:00:00Z'),
      }),
    );
    expect(r.uninvoiced).toMatchObject({ count: 0, beforeRecords: 1 });
  });
});

describe('a Communication VAS invoice', () => {
  const vasFile = (serial: string): Buffer =>
    vasCsv(serial, [
      { awb: 'W1', gross: '1.50', total: '1.77' },
      { awb: 'W2', gross: '1.00', total: '1.18' },
    ]);
  const lump = (serial: string, inr: string, iso: string): DlvLedgerTxn =>
    txn(null, 'DEBIT', inr, iso, {
      adj: true,
      detail: { remarks: 'VAS: NDR Whatsapp Verification', serial_number: serial },
    });

  it('matches exactly one lump wallet debit naming it, within a few paise', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [read(inv('EPVAS1', 'Communication VAS', '2026-08-31', 296), vasFile('EPVAS1'))],
        txns: [lump('EPVAS1', '2.95', '2026-09-01T06:00:00Z')],
      }),
    );
    expect(r.rows[0]).toMatchObject({ status: 'MATCHES', vasLumpInr: '2.95', totalsAgree: true });
  });

  it('DIFFERS when no wallet debit names it', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [read(inv('EPVAS0', 'Communication VAS', '2026-08-15', 295), vasFile('EPVAS0'))],
      }),
    );
    expect(r.rows[0]?.status).toBe('DIFFERS');
    expect(r.rows[0]?.vasLumpProblem).toMatch(/no wallet debit names it/);
  });

  it('names a lump debit for an invoice the list does not show', () => {
    const r = checkDelhiveryInvoices(
      input({
        invoices: [read(inv('EPVAS1', 'Communication VAS', '2026-08-15', 295), vasFile('EPVAS1'))],
        txns: [
          lump('EPVAS1', '2.95', '2026-08-16T06:00:00Z'),
          lump('EPVAS9', '10.00', '2026-09-05T06:00:00Z'),
        ],
      }),
    );
    expect(r.vasLumpsUnlisted).toEqual([
      expect.objectContaining({ invoiceId: 'EPVAS9', amountInr: '10.00', at: '2026-09-05' }),
    ]);
  });
});

describe('credit and debit notes', () => {
  const note = (noteId: string, date: string, paise: number): DlvNote => ({
    noteId,
    issuedAt: day(date),
    amountPaise: paise,
  });
  const claim = (inr: string, iso: string, awb = 'L1'): DlvLedgerTxn =>
    txn(awb, 'CREDIT', inr, iso, { adj: true, detail: CLAIM });

  it('one credit note can settle several claims', () => {
    const c1 = claim('1290.00', '2026-09-08T06:00:00Z');
    const c2 = claim('1499.00', '2026-09-08T07:00:00Z');
    const r = checkDelhiveryInvoices(
      input({
        creditNotes: [note('CD1', '2026-09-08', 278900)],
        debitNotes: [],
        notesFrom: new Date(NOW.getTime() - 90 * 86_400_000),
        txns: [c1, c2],
      }),
    );
    expect(r.creditNotes?.[0]).toMatchObject({ status: 'MATCHED' });
    expect([...(r.creditNotes?.[0]?.txnIds ?? [])].sort()).toEqual([c1.txnId, c2.txnId].sort());
    expect(r.claimsWithoutNote).toEqual([]);
  });

  it('names a claim payout older than 15 days with no note, and a note with no payout', () => {
    const r = checkDelhiveryInvoices(
      input({
        creditNotes: [note('CD2', '2026-09-01', 100000)],
        notesFrom: new Date(NOW.getTime() - 90 * 86_400_000),
        txns: [claim('500.00', '2026-08-10T06:00:00Z'), claim('700.00', '2026-09-05T06:00:00Z')],
      }),
    );
    expect(r.creditNotes?.[0]?.status).toBe('UNMATCHED');
    // The 5 Sep one is young enough to wait for its note.
    expect(r.claimsWithoutNote.map((c) => c.amountInr)).toEqual(['500.00']);
  });

  it('does not call a claim note-less when the notes list does not reach it', () => {
    const r = checkDelhiveryInvoices(
      input({
        creditNotes: [],
        notesFrom: day('2026-08-13'),
        txns: [claim('500.00', '2026-08-10T06:00:00Z')],
      }),
    );
    expect(r.claimsWithoutNote).toEqual([]);
  });

  it('a debit note is matched to account debits posted around it, and waits a few days for them', () => {
    const r = checkDelhiveryInvoices(
      input({
        debitNotes: [note('DN0', '2026-09-01', 5000), note('DN1', '2026-09-12', 14632)],
        txns: [txn(null, 'DEBIT', '50.00', '2026-09-02T06:00:00Z', { adj: true, detail: RECON })],
      }),
    );
    expect(r.debitNotes?.map((n) => [n.noteId, n.status])).toEqual([
      ['DN0', 'MATCHED'],
      ['DN1', 'PENDING'],
    ]);
  });
});
