import {
  classifyPassbookRow,
  ledgerCoverage,
  pairCodTopUps,
  parseLedgerRows,
  parsePassbook,
  parseRechargeHistory,
  parseShiprocketDate,
  parseShiprocketMoney,
  ShiprocketWalletFormatError,
} from '../../src/modules/courier-portal/services/shiprocket-wallet-rows';

/**
 * What a row of Shiprocket's wallet MEANS. The row shapes below are their
 * real ones (2026-09-11) — descriptions, sub categories, "NA" waybills,
 * negative balances — built into a passbook whose balances chain, newest
 * first, exactly as their page lists it.
 */
type Movement = readonly [
  when: string,
  orderId: string,
  awb: string,
  type: string,
  sub: string,
  description: string,
  paise: number,
];

const rupees = (p: number): string => {
  const a = Math.abs(p);
  const whole = Math.floor(a / 100).toLocaleString('en-IN');
  return `${whole}.${String(a % 100).padStart(2, '0')}`;
};

/** Oldest-first movements → their page's newest-first rows, with balances. */
function passbook(openingPaise: number, movements: readonly Movement[]): string[][] {
  let balance = openingPaise;
  const rows = movements.map(([when, order, awb, type, sub, desc, paise]) => {
    balance += paise;
    return [
      when,
      order,
      awb,
      type,
      sub,
      desc,
      `${paise < 0 ? '-' : '+'} ₹ ${rupees(paise)}`,
      `₹ ${balance < 0 ? '-' : ''}${rupees(balance)}`,
    ];
  });
  return rows.reverse();
}

const RECHARGE =
  'Bank ReferenceNo: pay_TXUpcKc5pqAmZZ | Order ID: order_TXUpO8UmoxuGQp | Payment Gateway: RZ';

const MOVEMENTS: Movement[] = [
  [
    '03 Sep, 2026 12:56 PM',
    '4651931705',
    'NA',
    'VAS',
    'RTO Score Charge',
    'LOW-RTO prediction',
    -412,
  ],
  [
    '03 Sep, 2026 01:18 PM',
    '2836809059',
    '14112364739585',
    'Freight Charges',
    'Freight RTO',
    'RTO charges applied',
    -8800,
  ],
  [
    '03 Sep, 2026 01:18 PM',
    '2836809059',
    '14112364739585',
    'Freight Charges',
    'Freight COD',
    'COD charges Reversed',
    4100,
  ],
  [
    '03 Sep, 2026 01:55 PM',
    'NA',
    'NA',
    'Recharge and Credit',
    'Recharge and Credit',
    RECHARGE,
    1500000,
  ],
  [
    '08 Sep, 2026 09:56 AM',
    'NA',
    'NA',
    'Recharge and Credit',
    'Recharge and Credit',
    'Subscription Charges.-Pro 2.0',
    79900,
  ],
  [
    '08 Sep, 2026 09:57 AM',
    'NA',
    'NA',
    'Recharge and Credit',
    'Recharge and Credit',
    'Credit Applied to Invoice #SRSI27HR00064405',
    -79900,
  ],
  [
    '09 Sep, 2026 03:34 PM',
    'NA',
    'NA',
    'Recharge and Credit',
    'Recharge and Credit',
    'Credit note for lost shipment #SF3771705459KR',
    46000,
  ],
  [
    '11 Sep, 2026 07:10 PM',
    '5650817040',
    '80156885583',
    'Freight Charges',
    'Freight Forward',
    'Forward charges applied',
    -9036,
  ],
  [
    '11 Sep, 2026 07:10 PM',
    '5650817040',
    '80156885583',
    'VAS',
    'WhatsApp Communication',
    'WhatsApp Communication charges',
    -590,
  ],
  [
    '11 Sep, 2026 07:10 PM',
    '5650817040',
    '80156885583',
    'VAS',
    'WhatsApp Communication',
    'WhatsApp Communication charges',
    -590,
  ],
];
// Opens below zero, as the real account did (₹ -19.98 on 3 Sep).
const ROWS = passbook(6802, MOVEMENTS);

describe('reading their clock and their money', () => {
  it('reads their timestamps as IST', () => {
    expect(parseShiprocketDate('11 Sep, 2026 07:10 PM')?.toISOString()).toBe(
      '2026-09-11T13:40:00.000Z',
    );
    expect(parseShiprocketDate('03 Sep, 2026')?.toISOString()).toBe('2026-09-02T18:30:00.000Z');
    expect(parseShiprocketDate('11 Sep, 2026 12:05 AM')?.toISOString()).toBe(
      '2026-09-10T18:35:00.000Z',
    );
    expect(parseShiprocketDate('Sept 11')).toBeNull();
  });

  it('reads signed amounts, grouped thousands and a negative balance, in paise', () => {
    expect(parseShiprocketMoney('- ₹ 66.15')).toBe(-6615);
    expect(parseShiprocketMoney('+ ₹ 15,000.00')).toBe(1500000);
    expect(parseShiprocketMoney('₹ -19.98')).toBe(-1998);
    expect(parseShiprocketMoney('₹ -8516.36')).toBe(-851636);
    expect(parseShiprocketMoney('₹ 460')).toBe(46000);
    expect(parseShiprocketMoney('free')).toBeNull();
  });
});

describe('parsePassbook', () => {
  const pb = parsePassbook(ROWS);

  it('proves the whole read with the balance chain', () => {
    expect(pb.chainBreaks).toEqual([]);
    expect(pb.newestBalanceInr).toBe(ROWS[0]?.[7]?.replace(/[₹,\s]/g, ''));
  });

  it('keeps a recharge OUT of the transactions — it is our money, not a refund', () => {
    expect(
      classifyPassbookRow(['', 'NA', 'NA', 'Recharge and Credit', 'Recharge and Credit', RECHARGE]),
    ).toBe('RECHARGE');
    expect(pb.txns.some((t) => (t.detail?.['description'] as string).startsWith('Bank Ref'))).toBe(
      false,
    );
    expect(pb.recharges).toEqual([
      {
        bankTxnRef: 'pay_TXUpcKc5pqAmZZ',
        amountInr: '15000.00',
        occurredAt: new Date('2026-09-03T08:25:00.000Z'),
      },
    ]);
  });

  it('files account-level money as ADJUSTMENT, naming no parcel', () => {
    const adj = pb.txns.filter((t) => t.category === 'ADJUSTMENT');
    // Lost-shipment credit, the subscription credit and its invoice, and a
    // charge on an order that never got a waybill.
    expect(adj).toHaveLength(4);
    expect(adj.every((t) => t.awbNumber === null)).toBe(true);
    const lost = adj.find((t) => String(t.detail?.['description']).startsWith('Credit note'));
    expect(lost).toMatchObject({ kind: 'CREDIT', amountInr: '460.00' });
  });

  it('keeps their order id on each charge — it outlives a reassigned waybill', () => {
    const parcels = pb.txns.filter((t) => t.category === 'PARCEL');
    expect(parcels.length).toBeGreaterThan(0);
    for (const t of parcels) {
      expect(t.courierOrderRef ?? '').toBe(String(t.detail?.['orderId'] ?? ''));
    }
  });

  it('files carriage per waybill, on the return leg when it is RTO freight', () => {
    const parcel = pb.txns.filter((t) => t.category === 'PARCEL');
    expect(parcel.map((t) => [t.awbNumber, t.leg, t.kind, t.amountInr])).toEqual([
      ['14112364739585', 'RTO', 'DEBIT', '88.00'],
      ['14112364739585', 'FORWARD', 'CREDIT', '41.00'],
      ['80156885583', 'FORWARD', 'DEBIT', '90.36'],
      ['80156885583', 'FORWARD', 'DEBIT', '5.90'],
      ['80156885583', 'FORWARD', 'DEBIT', '5.90'],
    ]);
  });

  it('gives two identical movements two ids, and the same ids on every read', () => {
    const ids = pb.txns.map((t) => t.txnId);
    expect(new Set(ids).size).toBe(ids.length);
    const whatsapp = pb.txns.filter((t) => t.amountInr === '5.90').map((t) => t.txnId);
    expect(whatsapp[0]?.replace(/-\d+$/, '')).toBe(whatsapp[1]?.replace(/-\d+$/, ''));
    expect(parsePassbook(ROWS).txns.map((t) => t.txnId)).toEqual(ids);
  });

  it('keeps old ids when a newer identical movement appears', () => {
    const more = passbook(6802, [
      ...MOVEMENTS,
      [
        '11 Sep, 2026 07:10 PM',
        '5650817040',
        '80156885583',
        'VAS',
        'WhatsApp Communication',
        'WhatsApp Communication charges',
        -590,
      ],
    ]);
    const before = pb.txns.map((t) => t.txnId);
    const after = parsePassbook(more).txns.map((t) => t.txnId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
  });

  it('keeps the balance after each movement as evidence', () => {
    expect(pb.txns.at(-1)?.detail?.['balanceAfterInr']).toBe(ROWS[0]?.[7]?.replace(/[₹,\s]/g, ''));
  });

  it('names a break in the chain — a movement dropped or misread between two rows', () => {
    const holed = ROWS.filter((_, i) => i !== 3); // drop one row from the middle
    const broken = parsePassbook(holed);
    expect(broken.chainBreaks).toHaveLength(1);
  });

  it('REFUSES a row it cannot read rather than skipping it', () => {
    const bad = ROWS.map((r) => [...r]);
    const first = bad[0];
    if (first !== undefined) first[6] = 'n/a';
    expect(() => parsePassbook(bad)).toThrow(ShiprocketWalletFormatError);
  });

  it('reports the span it covers and what it debited', () => {
    expect(pb.periodFrom?.toISOString()).toBe('2026-09-03T07:26:00.000Z');
    expect(pb.periodTo?.toISOString()).toBe('2026-09-11T13:40:00.000Z');
    // 4.12 + 88.00 + 799.00 + 90.36 + 5.90 + 5.90
    expect(pb.debitsInr).toBe('993.28');
  });
});

describe('parseRechargeHistory', () => {
  const history = [
    ['03 Sep, 2026', '856241788423700', '₹ 15000.00', 'Success', 'UPI', RECHARGE],
    [
      '24 Aug, 2026',
      '865331787564861',
      '₹ 10000.00',
      'Failed',
      'UPI',
      'Bank ReferenceNo: pay_TTYx96BaoE8wj2 | Order ID: order_TTYx2l19elnVBR | Payment Gateway: RZ-CR| Error : Payment was unsuccessful',
    ],
  ];

  it('reads their id, the bank reference and the status, with the passbook time when it has one', () => {
    const out = parseRechargeHistory(history, parsePassbook(ROWS).recharges);
    expect(out[0]).toEqual({
      externalTxnId: '856241788423700',
      bankTxnRef: 'pay_TXUpcKc5pqAmZZ',
      amountInr: '15000.00',
      status: 'Success',
      occurredAt: new Date('2026-09-03T08:25:00.000Z'),
    });
    // A failed top-up never reached the passbook: the day, in IST.
    expect(out[1]).toMatchObject({
      status: 'Failed',
      bankTxnRef: 'pay_TTYx96BaoE8wj2',
      occurredAt: new Date('2026-08-23T18:30:00.000Z'),
    });
  });

  it('refuses a row it cannot read', () => {
    expect(() =>
      parseRechargeHistory([['03 Sep, 2026', '', '₹ 1.00', 'Success', 'UPI', '']]),
    ).toThrow(ShiprocketWalletFormatError);
  });
});

describe('ledgerCoverage — their Ledger checked against their Passbook, never booked', () => {
  const pb = parsePassbook(ROWS);
  const ledger = (rows: string[][]) => ledgerCoverage(parseLedgerRows(rows), pb);

  it('finds a credit note dated days after the wallet moved', () => {
    // The wallet credit landed 9 Sep; their Ledger dates the note 20 Sep.
    const out = ledger([
      [
        '20 Sep, 2026',
        '20 Sep, 2026',
        'Credit Note',
        '₹ 0',
        '₹ 460',
        'CNSRFLD27H050594 Credit Note has been created',
        '₹ -89459.83',
      ],
      ['03 Sep, 2026', '03 Sep, 2026', 'Recharge', '₹ 0', '₹ 15000', RECHARGE, '₹ -97516.19'],
    ]);
    expect(out).toMatchObject({ checked: 2, uncovered: [] });
  });

  it('counts invoices and Early COD credits as documents, not wallet money', () => {
    const out = ledger([
      [
        '31 Aug, 2026',
        '31 Aug, 2026',
        'Shipping invoice',
        '₹ -53491.74',
        '₹ 0',
        'SRF27HR000404559 Invoice has been created',
        '₹ -81916.19',
      ],
      [
        '01 Aug, 2026',
        '01 Aug, 2026',
        'Early COD Invoice',
        '₹ -90',
        '₹ 0',
        'SRC27DL000050940 Invoice has been created',
        '₹ -62055.66',
      ],
      [
        '01 Aug, 2026',
        '01 Aug, 2026',
        'Other Wallet Credits',
        '₹ 0',
        '₹ 90',
        'Early COD Credit for Invoice #SRC27DL000050940',
        '₹ -62145.66',
      ],
    ]);
    expect(out).toEqual({ checked: 0, uncovered: [], documents: 3 });
  });

  it('names a credit their Ledger lists that no passbook movement matches', () => {
    const out = ledger([
      [
        '25 Aug, 2026',
        '25 Aug, 2026',
        'Other Wallet Credits',
        '₹ 0',
        '₹ 10100',
        'ShipSure Refunds Credited',
        '₹ -134727.93',
      ],
    ]);
    expect(out.uncovered).toEqual([
      {
        date: '2026-08-24',
        particulars: 'Other Wallet Credits',
        amountInr: '10100.00',
        description: 'ShipSure Refunds Credited',
      },
    ]);
  });

  it('lets one passbook movement answer for only one ledger line', () => {
    const note = ['10 Sep, 2026', '10 Sep, 2026', 'Credit Note', '₹ 0', '₹ 460', 'CN-A', '₹ 0'];
    const out = ledger([note, [...note.slice(0, 5), 'CN-B', '₹ 0']]);
    expect(out.checked).toBe(2);
    expect(out.uncovered).toHaveLength(1);
  });
});

/**
 * Shiprocket Postpaid: part of a COD payout goes into the wallet instead
 * of the bank. That credit is OUR money moving — booked as a top-up on
 * the payout — so the passbook must not store it as the courier handing
 * us income.
 */
describe('a wallet credit funded from a COD payout', () => {
  const rows = passbook(0, [
    [
      '05 Oct, 2026 10:00 AM',
      'NA',
      'NA',
      'Recharge and Credit',
      'Recharge and Credit',
      'Amount credited from COD remittance CRF 13449838',
      50000,
    ],
    [
      '05 Oct, 2026 11:00 AM',
      '5650817040',
      '80156885583',
      'Freight Charges',
      'Freight Forward',
      'Forward charges applied',
      -9036,
    ],
    [
      '06 Oct, 2026 03:34 PM',
      'NA',
      'NA',
      'Recharge and Credit',
      'Recharge and Credit',
      'Credit note for lost shipment #SF3771705459KR',
      46000,
    ],
  ]);

  it('is set aside as a top-up: not a transaction, not a courier credit', () => {
    const pb = parsePassbook(rows);
    expect(pb.chainBreaks).toHaveLength(0);
    expect(pb.codTopUps.map((c) => c.amountPaise)).toEqual([50000]);
    // The freight is still the parcel's cost, and a real credit note is
    // still the courier's credit — only the top-up is left out.
    expect(pb.txns.map((t) => t.category)).toEqual(['PARCEL', 'ADJUSTMENT']);
    expect(pb.accountCredits.map((c) => c.amountPaise)).toEqual([46000]);
  });

  it('counts as present when their Ledger lists it', () => {
    const pb = parsePassbook(rows);
    const cov = ledgerCoverage(
      [
        {
          date: new Date('2026-10-05T00:00:00Z'),
          particulars: 'Other Wallet Credits',
          debitPaise: 0,
          creditPaise: 50000,
          description: 'COD remittance',
        },
      ],
      pb,
    );
    expect(cov.uncovered).toHaveLength(0);
  });
});

describe('pairCodTopUps', () => {
  const at = (s: string): Date => new Date(s);
  const credit = (paise: number, when: string) => ({
    amountPaise: paise,
    occurredAt: at(when),
    description: 'COD remittance',
  });

  it('pairs a payout with the credit of the same amount, nearest first', () => {
    const out = pairCodTopUps(
      [{ reference: 'UTR-1', amountPaise: 50000, at: at('2026-10-04T10:00:00Z') }],
      [credit(50000, '2026-10-20T10:00:00Z'), credit(50000, '2026-10-05T10:00:00Z')],
    );
    expect(out.unseen).toHaveLength(0);
    // The far one is left over — a second top-up with no payout behind it.
    expect(out.unclaimed.map((c) => c.occurredAt.toISOString())).toEqual([
      '2026-10-20T10:00:00.000Z',
    ]);
  });

  it('names a payout whose top-up never appeared, and a credit with no payout', () => {
    const out = pairCodTopUps(
      [{ reference: 'UTR-2', amountPaise: 30000, at: at('2026-10-04T10:00:00Z') }],
      [credit(12000, '2026-10-05T10:00:00Z')],
    );
    expect(out.unseen.map((u) => u.reference)).toEqual(['UTR-2']);
    expect(out.unclaimed).toHaveLength(1);
  });
});
