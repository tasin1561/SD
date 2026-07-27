import { PaymentMode } from '@skydrop/db';
import { DelhiveryServiceabilityService } from '../../src/modules/courier-delhivery/services/delhivery-serviceability.service';
import { DelhiveryTatService } from '../../src/modules/courier-delhivery/services/delhivery-tat.service';
import { DelhiveryCostService } from '../../src/modules/courier-delhivery/services/delhivery-cost.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';

type AnyArgs = Record<string, unknown>;

/**
 * The fixtures below are VERBATIM production responses captured on
 * 2026-07-27, not invented shapes. That is the point: this account has no
 * sandbox, so the only way these parsers can be trusted is to pin them to
 * what the live API really returned.
 */
const LIVE_SERVICEABLE = {
  delivery_codes: [
    {
      postal_code: {
        remarks: '',
        pin: 110042,
        country_code: 'IN',
        state_code: 'DL',
        cod: 'Y',
        pre_paid: 'Y',
        pickup: 'Y',
        cash: 'Y',
        repl: 'Y',
        district: 'North West Delhi',
        is_oda: 'N',
        sort_code: 'DEL/UDY',
        max_amount: 0.0,
        max_weight: 0.0,
      },
    },
  ],
};

/** PIN 190001 (Srinagar) — live response, temporarily embargoed. */
const LIVE_EMBARGO = {
  delivery_codes: [
    {
      postal_code: {
        remarks: 'Embargo',
        pin: 190001,
        state_code: 'JK',
        cod: 'Y',
        pre_paid: 'Y',
        pickup: 'Y',
        repl: 'Y',
        is_oda: 'N',
        sort_code: 'SRI/DSA',
        max_amount: 0.0,
        max_weight: 0.0,
      },
    },
  ],
};

/** PIN 999999 — live response for an unknown pin. */
const LIVE_NSZ = { delivery_codes: [] };

function makeHttp(response: unknown, stub = false) {
  const request = jest.fn<Promise<unknown>, [AnyArgs]>(async () => response);
  const isStubMode = jest.fn(async () => stub);
  return {
    http: { request, isStubMode } as unknown as DelhiveryHttpService,
    request,
  };
}

describe('DelhiveryServiceabilityService — against live response shapes', () => {
  it('a serviceable pin reports every capability', async () => {
    const { http } = makeHttp(LIVE_SERVICEABLE);
    const d = await new DelhiveryServiceabilityService(http).describePin('110042');
    expect(d).toMatchObject({
      serviceable: true,
      embargo: false,
      codAllowed: true,
      prepaidAllowed: true,
      pickupAllowed: true,
      outOfDeliveryArea: false,
      stateCode: 'DL',
      sortCode: 'DEL/UDY',
      fromLiveApi: true,
    });
  });

  it('EMBARGO is NOT serviceable — the bug a length check hides', async () => {
    // Delhivery returns a full record for an embargoed pin. Counting the
    // array calls it serviceable, we manifest, and it bounces at our cost.
    const { http } = makeHttp(LIVE_EMBARGO);
    const d = await new DelhiveryServiceabilityService(http).describePin('190001');
    expect(d.embargo).toBe(true);
    expect(d.serviceable).toBe(false);
  });

  it('an empty list is the true NSZ signal', async () => {
    const { http } = makeHttp(LIVE_NSZ);
    const d = await new DelhiveryServiceabilityService(http).describePin('999999');
    expect(d.serviceable).toBe(false);
    expect(d.embargo).toBe(false);
  });

  it('canShip rejects COD to a prepaid-only pin', async () => {
    const { http } = makeHttp({
      delivery_codes: [
        { postal_code: { remarks: '', cod: 'N', pre_paid: 'Y', is_oda: 'N' } },
      ],
    });
    const svc = new DelhiveryServiceabilityService(http);
    await expect(
      svc.canShip({ pincode: '110001', paymentMode: PaymentMode.COD }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('NOT for COD') });
    await expect(
      svc.canShip({ pincode: '110001', paymentMode: PaymentMode.PREPAID }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('canShip enforces a per-pin COD ceiling', async () => {
    const { http } = makeHttp({
      delivery_codes: [
        {
          postal_code: {
            remarks: '',
            cod: 'Y',
            pre_paid: 'Y',
            is_oda: 'N',
            max_amount: 5000,
          },
        },
      ],
    });
    const svc = new DelhiveryServiceabilityService(http);
    await expect(
      svc.canShip({
        pincode: '110001',
        paymentMode: PaymentMode.COD,
        codAmountInr: 7500,
      }),
    ).resolves.toMatchObject({ ok: false, reason: expect.stringContaining('exceeds') });
    await expect(
      svc.canShip({
        pincode: '110001',
        paymentMode: PaymentMode.COD,
        codAmountInr: 4000,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('ODA is surfaced but does NOT block — it is reachable, just dearer', async () => {
    const { http } = makeHttp({
      delivery_codes: [
        { postal_code: { remarks: '', cod: 'Y', pre_paid: 'Y', is_oda: 'Y' } },
      ],
    });
    const r = await new DelhiveryServiceabilityService(http).canShip({
      pincode: '190010',
      paymentMode: PaymentMode.COD,
    });
    expect(r.ok).toBe(true);
    expect(r.detail.outOfDeliveryArea).toBe(true);
  });

  it('the adapter-interface slice still answers a plain boolean', async () => {
    const { http } = makeHttp(LIVE_EMBARGO);
    await expect(
      new DelhiveryServiceabilityService(http).checkServiceability('190001'),
    ).resolves.toEqual({ serviceable: false, fromLiveApi: true });
  });
});

describe('DelhiveryTatService — against the live response shape', () => {
  it('parses the live envelope (Delhi→Bangalore surface came back as 5 days)', async () => {
    const { http, request } = makeHttp({ success: true, msg: '', data: { tat: 5 } });
    const r = await new DelhiveryTatService(http).expectedTat({
      originPin: '110042',
      destinationPin: '560001',
    });
    expect(r).toMatchObject({ tatDays: 5, mode: 'S', fromLiveApi: true });
    const path = String((request.mock.calls[0]![0] as AnyArgs)['path']);
    expect(path).toContain('mot=S');
    expect(path).toContain('pdt=B2C');
  });

  it('returns null rather than a fake number when Delhivery declines the lane', async () => {
    const { http } = makeHttp({ success: false, msg: 'No TAT configured' });
    const r = await new DelhiveryTatService(http).expectedTat({
      originPin: '110042',
      destinationPin: '999999',
    });
    expect(r.tatDays).toBeNull();
    expect(r.message).toBe('No TAT configured');
  });
});

describe('DelhiveryCostService — against the live response shape', () => {
  /** Verbatim production row: 110042 → 560001, 1500g, surface, COD. */
  const LIVE_COD_ROW = [
    {
      status: 'Delivered',
      zone: 'C2',
      charge_DL: 119,
      charge_COD: 25,
      charge_DPH: 4.39,
      charge_PEAK: 1,
      gross_amount: 149.39,
      total_amount: 176.29,
      charged_weight: 1500,
      divisor: 5000,
      tax_data: { SGST: 13.45, CGST: 13.45, IGST: 0, service_tax: 0 },
    },
  ];

  it('extracts what Delhivery actually bills us, tax included', async () => {
    const { http } = makeHttp(LIVE_COD_ROW);
    const r = await new DelhiveryCostService(http).estimate({
      originPin: '110042',
      destinationPin: '560001',
      chargeableWeightGrams: 1500,
      paymentType: 'COD',
    });
    expect(r).toMatchObject({
      totalInr: '176.29',
      grossInr: '149.39',
      deliveryInr: '119',
      codFeeInr: '25',
      zone: 'C2',
      chargedWeightGrams: 1500,
      // The number M15's deferred volumetric-weight calculation needs.
      volumetricDivisor: 5000,
      taxInr: '26.9',
      fromLiveApi: true,
    });
  });

  it('keeps every non-zero surcharge for the forensic trail', async () => {
    const { http } = makeHttp(LIVE_COD_ROW);
    const r = await new DelhiveryCostService(http).estimate({
      originPin: '110042',
      destinationPin: '560001',
      chargeableWeightGrams: 1500,
      paymentType: 'COD',
    });
    // When a courier bill is disputed, "which surcharge moved" is the
    // only useful question — so zero-valued components are dropped and
    // non-zero ones kept.
    expect(r.components).toMatchObject({
      charge_DL: '119',
      charge_COD: '25',
      charge_DPH: '4.39',
      charge_PEAK: '1',
    });
    expect(r.components).not.toHaveProperty('charge_RTO');
  });

  it('always sends pt — omitting it is why the API returns zeros', async () => {
    const { http, request } = makeHttp(LIVE_COD_ROW);
    await new DelhiveryCostService(http).estimate({
      originPin: '110042',
      destinationPin: '560001',
      chargeableWeightGrams: 1500,
      paymentType: 'Pre-paid',
    });
    expect(String((request.mock.calls[0]![0] as AnyArgs)['path'])).toContain(
      'pt=Pre-paid',
    );
  });
});
