import { ActorType } from '@skydrop/db';
import {
  CourierAwbDispatchService,
  type DispatchAwbInput,
} from '../../src/modules/courier-awb/services/courier-awb-dispatch.service';
import type { DelhiveryAwbService } from '../../src/modules/courier-delhivery/services/delhivery-awb.service';
import type { DelhiveryLabelService } from '../../src/modules/courier-delhivery/services/delhivery-label.service';
import type { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';

type AnyArgs = any;

const ACTOR = { type: ActorType.SYSTEM, id: null };

function input(over: Partial<DispatchAwbInput> = {}): DispatchAwbInput {
  return {
    courierCode: 'delhivery',
    courierAccountId: 'acc-1',
    shipmentId: 'ship-1',
    shipmentNumber: 'SH-2026-05-000042',
    orderNumber: 'SD-2026-05-000042',
    pickupLocationName: 'Bengaluru WH',
    recipientName: 'Asha',
    recipientPhoneE164: '+919876543210',
    addressLine1: '12 MG Road',
    addressLine2: 'Near the water tank',
    city: 'Bengaluru',
    stateProvince: 'Karnataka',
    postalCode: '560001',
    countryCode: 'IN',
    totalWeightGrams: 500,
    declaredValueInr: '999.00',
    codAmountInr: '999.00',
    itemDescription: 'Widget',
    items: [{ name: 'Widget', sku: 'W-1', quantity: 2, unitPriceInr: 499.5 }],
    lengthCm: 10,
    breadthCm: 10,
    heightCm: 10,
    ...over,
  };
}

function makeService(
  opts: {
    delhivery?: AnyArgs;
    shiprocket?: AnyArgs;
    shiprocketLabel?: AnyArgs;
    delhiveryStub?: boolean;
    shiprocketStub?: boolean;
    disabledCouriers?: string[];
  } = {},
) {
  const delhiveryGenerate = jest.fn(
    async () =>
      opts.delhivery ?? { ok: true, awbNumber: 'DLV123', courierShipmentId: null, labelUrl: null },
  );
  const shiprocketGenerate = jest.fn<Promise<AnyArgs>, [AnyArgs, string]>(
    async () => opts.shiprocket ?? { ok: true, awbNumber: 'SR456', courierShipmentId: '887766' },
  );
  const delhiveryFetchLabel = jest.fn(async () => ({
    bytes: Buffer.from('%PDF stub'),
    mimeType: 'application/pdf',
  }));
  const shiprocketFetchLabel = jest.fn(
    async () => opts.shiprocketLabel ?? { url: null, message: 'not ready' },
  );
  const svc = new CourierAwbDispatchService(
    { generateAwb: delhiveryGenerate } as unknown as DelhiveryAwbService,
    { fetchLabel: delhiveryFetchLabel } as unknown as DelhiveryLabelService,
    {
      generateAwb: shiprocketGenerate,
      fetchLabel: shiprocketFetchLabel,
    } as unknown as ShiprocketClientService,
    // The two http services, so the saga can ask whether a courier is
    // answering from a stub before it trusts a failover.
    { isStubMode: async () => opts.delhiveryStub ?? false } as never,
    { isStubMode: async () => opts.shiprocketStub ?? false } as never,
    // The intake switch. Defaults to ON so the marshalling tests below
    // keep testing marshalling; the OFF case has its own test.
    {
      canTakeNewParcels: async (code: string) => !(opts.disabledCouriers ?? []).includes(code),
    } as never,
  );
  return { svc, delhiveryGenerate, shiprocketGenerate, delhiveryFetchLabel, shiprocketFetchLabel };
}

/**
 * The dispatcher's whole job is to make two different couriers answer the
 * same question, so what is worth testing is the TRANSLATION — and above
 * all `serviceable`, which is the field the saga makes decisions on.
 * Getting it backwards for one courier would mean either a permanent
 * refusal retried forever, or a bad minute treated as a refusal and the
 * parcel handed to a competitor.
 */
describe('CourierAwbDispatchService', () => {
  it('routes by courier code and does not call the other adapter', async () => {
    const { svc, delhiveryGenerate, shiprocketGenerate } = makeService();

    await svc.generate(input({ courierCode: 'delhivery' }), ACTOR);
    expect(delhiveryGenerate).toHaveBeenCalledTimes(1);
    expect(shiprocketGenerate).not.toHaveBeenCalled();

    await svc.generate(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(shiprocketGenerate).toHaveBeenCalledTimes(1);
    expect(delhiveryGenerate).toHaveBeenCalledTimes(1);
  });

  it('Delhivery carries no separate parcel id — its waybill is the identifier', async () => {
    const { svc } = makeService();
    const r = await svc.generate(input({ courierCode: 'delhivery' }), ACTOR);
    expect(r).toMatchObject({ ok: true, awbNumber: 'DLV123', courierShipmentId: null });
  });

  it('Shiprocket returns BOTH an AWB and their own id, and both survive', async () => {
    const { svc } = makeService();
    const r = await svc.generate(input({ courierCode: 'shiprocket' }), ACTOR);
    // Their label, pickup and cancel endpoints key on courierShipmentId,
    // not on the AWB — dropping it here would strand the parcel.
    expect(r).toMatchObject({ ok: true, awbNumber: 'SR456', courierShipmentId: '887766' });
  });

  it("Shiprocket's TRANSIENT means retry; PERMANENT means find another courier", async () => {
    const transient = makeService({
      shiprocket: { ok: false, failure: 'TRANSIENT', message: 'gateway timeout' },
    });
    const t = await transient.svc.generate(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(t.serviceable).toBe(true);

    const permanent = makeService({
      shiprocket: { ok: false, failure: 'PERMANENT', message: 'pincode not serviceable' },
    });
    const p = await permanent.svc.generate(input({ courierCode: 'shiprocket' }), ACTOR);
    expect(p.serviceable).toBe(false);
    expect(p.errorCode).toBe('PERMANENT');
  });

  it("passes Delhivery's own serviceable verdict through unchanged", async () => {
    const { svc } = makeService({
      delhivery: {
        ok: false,
        serviceable: false,
        errorCode: 'NON_SERVICEABLE',
        errorMessage: 'pin not served',
      },
    });
    const r = await svc.generate(input({ courierCode: 'delhivery' }), ACTOR);
    expect(r).toMatchObject({ ok: false, serviceable: false, errorCode: 'NON_SERVICEABLE' });
  });

  it('a courier with no adapter is a manual courier, not a retry', async () => {
    const { svc, delhiveryGenerate, shiprocketGenerate } = makeService();
    const r = await svc.generate(input({ courierCode: 'bluedart' }), ACTOR);

    expect(delhiveryGenerate).not.toHaveBeenCalled();
    expect(shiprocketGenerate).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    // serviceable:false is what sends it to a person. true would retry an
    // integration that does not exist, forever.
    expect(r.serviceable).toBe(false);
    expect(r.errorCode).toBe('NO_ADAPTER');
  });

  it('COD is decided by the amount being present, not by a flag that could disagree', async () => {
    const { svc, shiprocketGenerate } = makeService();

    await svc.generate(input({ courierCode: 'shiprocket', codAmountInr: '999.00' }), ACTOR);
    expect((shiprocketGenerate.mock.calls[0]?.[0] as AnyArgs).paymentMode).toBe('COD');

    await svc.generate(input({ courierCode: 'shiprocket', codAmountInr: null }), ACTOR);
    expect((shiprocketGenerate.mock.calls[1]?.[0] as AnyArgs).paymentMode).toBe('PREPAID');
  });
});

describe('CourierAwbDispatchService — the intake switch', () => {
  it('refuses to book with a courier that is switched off', async () => {
    const { svc, delhiveryGenerate } = makeService({ disabledCouriers: ['delhivery'] });
    const r = await svc.generate(input({ courierCode: 'delhivery' }), ACTOR);

    // The distribution layer already avoids a disabled courier, but a
    // shipment can arrive here already carrying one — a seller link
    // made before the switch, a supersede replacement, a manual re-run.
    expect(delhiveryGenerate).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('COURIER_DISABLED');
  });

  it('reports it as NOT serviceable, so it reaches a human instead of retrying', async () => {
    const { svc } = makeService({ disabledCouriers: ['shiprocket'] });
    const r = await svc.generate(input({ courierCode: 'shiprocket' }), ACTOR);

    // serviceable:true would retry a switch somebody turned off on
    // purpose, forever.
    expect(r.serviceable).toBe(false);
  });

  it('does not affect the courier that is still on', async () => {
    const { svc, delhiveryGenerate, shiprocketGenerate } = makeService({
      disabledCouriers: ['shiprocket'],
    });

    const r = await svc.generate(input({ courierCode: 'delhivery' }), ACTOR);
    expect(r.ok).toBe(true);
    expect(delhiveryGenerate).toHaveBeenCalledTimes(1);
    expect(shiprocketGenerate).not.toHaveBeenCalled();
  });
});
