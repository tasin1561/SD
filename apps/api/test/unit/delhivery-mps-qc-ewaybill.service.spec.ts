import { DelhiveryMpsService } from '../../src/modules/courier-delhivery/services/delhivery-mps.service';
import {
  DelhiveryRvpQcService,
  type QcItem,
} from '../../src/modules/courier-delhivery/services/delhivery-rvp-qc.service';
import {
  DelhiveryEwaybillService,
  EWAYBILL_THRESHOLD_INR,
} from '../../src/modules/courier-delhivery/services/delhivery-ewaybill.service';
import type { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { DelhiveryWriteGuardService } from '../../src/modules/courier-delhivery/services/delhivery-write-guard.service';
import { DelhiveryMarginReconciliationService } from '../../src/modules/courier-delhivery/services/delhivery-margin-reconciliation.service';
import type { DelhiveryCostService } from '../../src/modules/courier-delhivery/services/delhivery-cost.service';

type AnyArgs = Record<string, unknown>;

describe('DelhiveryMpsService — one order, several boxes', () => {
  const svc = new DelhiveryMpsService();
  const box = (waybill: string) => ({
    waybill,
    weightGrams: 500,
    itemDescription: 'Toy car',
  });

  it('ties every box to the master waybill — that link IS the consignment', () => {
    // Without master_id on each box, Delhivery treats them as unrelated
    // parcels: three tracking identities, three deliveries, no shared fate.
    const plan = svc.plan({
      boxes: [box('111'), box('222'), box('333')],
      masterWaybill: '111',
      totalCodInr: null,
    });
    expect(plan.childCount).toBe(3);
    for (const keys of plan.boxKeys) {
      expect(keys).toMatchObject({
        master_id: '111',
        mps_children: 3,
        shipment_type: 'MPS',
      });
    }
  });

  it('puts the COD total on the consignment, NOT once per box', () => {
    // Repeating the full amount per box would ask the customer to pay
    // three times over.
    const plan = svc.plan({
      boxes: [box('111'), box('222')],
      masterWaybill: '111',
      totalCodInr: '2500.00',
    });
    expect(plan.mpsAmountInr).toBe('2500.00');
    for (const keys of plan.boxKeys) {
      expect(keys['mps_amount']).toBe('2500.00');
    }
  });

  it('refuses duplicate waybills — two boxes would collapse into one identity', () => {
    expect(() =>
      svc.plan({
        boxes: [box('111'), box('111')],
        masterWaybill: '111',
        totalCodInr: null,
      }),
    ).toThrow(/DISTINCT/);
  });

  it('refuses a single box — that is an ordinary shipment', () => {
    expect(() =>
      svc.plan({ boxes: [box('111')], masterWaybill: '111', totalCodInr: null }),
    ).toThrow(/at least 2 boxes/);
  });

  it('refuses a master that is not one of the boxes', () => {
    expect(() =>
      svc.plan({
        boxes: [box('111'), box('222')],
        masterWaybill: '999',
        totalCodInr: null,
      }),
    ).toThrow(/not one of the boxes/);
  });

  it('refuses an empty waybill — Delhivery will not assign them for MPS', () => {
    expect(() =>
      svc.plan({
        boxes: [box('111'), box('  ')],
        masterWaybill: '111',
        totalCodInr: null,
      }),
    ).toThrow(/pre-fetched waybill/);
  });
});

describe('DelhiveryRvpQcService — doorstep checks on a return', () => {
  const svc = new DelhiveryRvpQcService();
  const question = (id: string) => ({
    questionId: id,
    type: 'multi' as const,
    options: ['Yes', 'No'],
    correctValues: ['Yes'],
    required: true,
  });
  const item = (over: Partial<QcItem> = {}): QcItem => ({
    description: 'Blue running shoes, size 9',
    images: ['https://cdn/shoe.jpg'],
    quantity: 1,
    questions: [question('q1')],
    ...over,
  });

  it('builds the parametric QC payload', () => {
    const keys = svc.buildQcKeys([item()]);
    expect(keys['qc_type']).toBe('param');
    const qc = keys['custom_qc'] as AnyArgs[];
    expect(qc[0]).toMatchObject({ description: 'Blue running shoes, size 9', quantity: 1 });
    expect((qc[0]!['questions'] as AnyArgs[])[0]).toMatchObject({
      questions_id: 'q1',
      type: 'multi',
      required: true,
    });
  });

  it('REFUSES more than 2 items — exceeding it silently disables QC entirely', () => {
    // Delhivery: "the shipment will still be created, but it will be
    // marked as a non-QC shipment". No error. You would believe checks
    // were happening at the door when nothing was being checked.
    expect(() => svc.buildQcKeys([item(), item(), item()])).toThrow(/at most 2 QC items/);
  });

  it('REFUSES more than 6 questions per item — same silent downgrade', () => {
    const seven = Array.from({ length: 7 }, (_, i) => question(`q${i}`));
    expect(() => svc.buildQcKeys([item({ questions: seven })])).toThrow(
      /at most 6 questions/,
    );
  });

  it('requires a reference image — the executive has nothing to compare against otherwise', () => {
    expect(() => svc.buildQcKeys([item({ images: [] })])).toThrow(/reference image/);
  });

  it('requires a correct answer, else the check can never fail', () => {
    expect(() =>
      svc.buildQcKeys([
        item({ questions: [{ ...question('q1'), correctValues: [] }] }),
      ]),
    ).toThrow(/no correct answer/);
  });

  it('carries `required: false` through — asked, but cannot fail the pickup', () => {
    const keys = svc.buildQcKeys([
      item({ questions: [{ ...question('q1'), required: false }] }),
    ]);
    const qc = keys['custom_qc'] as AnyArgs[];
    expect((qc[0]!['questions'] as AnyArgs[])[0]!['required']).toBe(false);
  });
});

describe('DelhiveryEwaybillService', () => {
  const build = (stub = false) => {
    const request = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async () => ({}));
    const http = {
      isStubMode: jest.fn(async () => stub),
      request,
    } as unknown as DelhiveryHttpService;
    const guard = {
      assertWritable: jest.fn(async () => undefined),
    } as unknown as DelhiveryWriteGuardService;
    return { svc: new DelhiveryEwaybillService(http, guard), request };
  };

  it('knows when Indian law requires an e-way bill', () => {
    const { svc } = build();
    expect(svc.requiresEwaybill(EWAYBILL_THRESHOLD_INR + 1)).toBe(true);
    expect(svc.requiresEwaybill(EWAYBILL_THRESHOLD_INR)).toBe(false);
    expect(svc.requiresEwaybill(1200)).toBe(false);
  });

  it('PUTs to the per-waybill path with the documented envelope', async () => {
    const { svc, request } = build();
    await svc.update({
      awbNumber: '38061110478262',
      invoiceNumber: 'INV-1',
      ewaybillNumber: 'EWB-9',
    });
    expect(request.mock.calls[0]![0]).toMatchObject({
      method: 'PUT',
      path: '/api/rest/ewaybill/38061110478262/',
      body: { data: [{ dcn: 'INV-1', ewbn: 'EWB-9' }] },
    });
  });
});

describe('DelhiveryMarginReconciliationService — margin against reality', () => {
  const build = (actualTotal: string): DelhiveryMarginReconciliationService => {
    const cost = {
      estimate: jest.fn(async () => ({ totalInr: actualTotal })),
    } as unknown as DelhiveryCostService;
    return new DelhiveryMarginReconciliationService(cost);
  };

  const LANE = {
    originPin: '110042',
    destinationPin: '560001',
    chargeableWeightGrams: 1500,
    isCod: true,
  };

  it('computes margin from what Delhivery ACTUALLY charges, not the rate card', async () => {
    // Real production figure for this lane, 1500g COD: ₹176.29.
    const r = await build('176.29').check({ ...LANE, billedToSellerInr: '250.00' });
    expect(r.actualCourierCostInr).toBe('176.29');
    expect(r.marginInr).toBe('73.71');
    expect(r.lossMaking).toBe(false);
  });

  it('flags a LOSS-MAKING lane', async () => {
    // The case that is invisible until the P&L is off: we bill less than
    // the courier charges.
    const r = await build('176.29').check({ ...LANE, billedToSellerInr: '150.00' });
    expect(r.lossMaking).toBe(true);
    expect(r.marginInr).toBe('-26.29');
  });

  it('measures how wrong the rate card assumption is', async () => {
    const r = await build('176.29').check({
      ...LANE,
      billedToSellerInr: '250.00',
      assumedCostInr: '120.00',
    });
    // The card assumes ₹120; reality is ₹176.29 — every margin figure
    // computed from the card is overstated by ₹56.29.
    expect(r.assumptionDriftInr).toBe('56.29');
  });

  it('does not divide by zero when nothing was billed', async () => {
    const r = await build('176.29').check({ ...LANE, billedToSellerInr: '0' });
    expect(r.marginPercent).toBe('0');
    expect(r.lossMaking).toBe(true);
  });
});
