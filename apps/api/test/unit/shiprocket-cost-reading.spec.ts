import {
  amount,
  readingFromOrder,
} from '../../src/modules/shiprocket-cost-sync/services/shiprocket-cost-reading';

/**
 * What one Shiprocket order says a parcel cost. Every case below is a
 * real order read from our account on 2026-09-11.
 */
const order = (status: string, charges: Record<string, unknown>, awb = 'AWB1') => ({
  status,
  awb_data: { awb, charges },
});

describe('readingFromOrder — their final figure, and an honest estimate', () => {
  it('a returned parcel: their billing_amount already nets the COD reversal and the RTO', () => {
    // 14112361950132: 114.40 forward − 47 COD reversed + 96 RTO = 163.40.
    const r = readingFromOrder(
      order('RTO DELIVERED', {
        cod_charges: 47,
        applied_weight_amount: '114.40',
        freight_charges: '114.40',
        charged_weight_amount: '114.40',
        charged_weight_amount_rto: '96.00',
        billing_amount: '163.40',
      }),
    );
    expect(r).toMatchObject({ billedInr: '163.40', provisionalInr: '163.40', returned: true });
  });

  it('a delivered parcel: billed as charged', () => {
    const r = readingFromOrder(
      order('DELIVERED', {
        cod_charges: 47,
        applied_weight_amount: '94.00',
        freight_charges: '94.00',
        charged_weight_amount_rto: '0.00',
        billing_amount: '94.00',
      }),
    );
    expect(r).toMatchObject({ billedInr: '94.00', provisionalInr: '94.00', returned: false });
  });

  it('not billed yet: the estimate is kept, the final figure is NULL — never zero', () => {
    // 9711128000, delivered on 9 Sep and still unbilled on the 11th.
    const r = readingFromOrder(
      order('DELIVERED', {
        freight_charges: 90.36,
        cod_charges: 42,
        charged_weight_amount_rto: '0.00',
        billing_amount: '',
      }),
    );
    expect(r?.billedInr).toBeNull();
    expect(r?.provisionalInr).toBe('90.36');
  });

  it('where the estimate is wrong, their final figure is what counts', () => {
    // 1505825383: the rebuilt figure is 151.35; they billed 149.10.
    const r = readingFromOrder(
      order('RTO DELIVERED', {
        cod_charges: 45,
        charged_weight_amount: '130.20',
        charged_weight_amount_rto: '66.15',
        billing_amount: '149.10',
      }),
    );
    expect(r?.provisionalInr).toBe('151.35');
    expect(r?.billedInr).toBe('149.10');
  });

  it('a cancelled order was charged nothing', () => {
    const r = readingFromOrder(
      order(
        'CANCELED',
        { cod_charges: 'N/A', freight_charges: '-', applied_weight_amount: 'N/A' },
        '',
      ),
    );
    expect(r).toMatchObject({ provisionalInr: '0.00', billedInr: null, awbNumber: null });
  });

  it.each(['RTO_NDR', 'RTO IN INTRANSIT', 'RTO_OFD', 'REACHED BACK AT THE SELLER CITY'])(
    '"%s" is a parcel that came back',
    (status) => {
      expect(readingFromOrder(order(status, { freight_charges: '50.00' }))?.returned).toBe(true);
    },
  );

  it('an order with no status is not a reading', () => {
    expect(readingFromOrder({ awb_data: {} })).toBeNull();
    expect(readingFromOrder(null)).toBeNull();
  });

  it('the fingerprint moves when the bill arrives, and only then', () => {
    const before = readingFromOrder(
      order('DELIVERED', { freight_charges: '94.00', billing_amount: '' }),
    );
    const same = readingFromOrder(
      order('DELIVERED', { freight_charges: '94.00', billing_amount: '' }),
    );
    const after = readingFromOrder(
      order('DELIVERED', { freight_charges: '94.00', billing_amount: '94.00' }),
    );
    expect(same?.fingerprint).toBe(before?.fingerprint);
    expect(after?.fingerprint).not.toBe(before?.fingerprint);
  });
});

describe('amount — a value they send blank is unknown, not zero', () => {
  it.each([
    ['', null],
    ['N/A', null],
    ['-', null],
    [undefined, null],
    ['12.50', 12.5],
    [49, 49],
  ])('%p → %p', (v, want) => {
    expect(amount(v)).toBe(want);
  });
});
