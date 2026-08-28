import { CourierShipmentInsightService } from '../../src/modules/courier-ops/services/courier-shipment-insight.service';
import type { ShipmentCourierContextService } from '../../src/modules/courier-ops/services/shipment-courier-context.service';
import type { DelhiveryTatService } from '../../src/modules/courier-delhivery/services/delhivery-tat.service';
import type { DelhiveryCostService } from '../../src/modules/courier-delhivery/services/delhivery-cost.service';
import type { DelhiveryDocumentService } from '../../src/modules/courier-delhivery/services/delhivery-document.service';
import type { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';

function ctx(over: Record<string, unknown> = {}) {
  return {
    shipmentId: 'ship-1',
    shipmentNumber: 'SH-1',
    awbNumber: 'SR123',
    courierCode: 'shiprocket',
    courierAccountId: 'sr-1',
    courierShipmentId: '99887',
    isManualCourier: false,
    status: 'AWB_GENERATED',
    originPin: '560001',
    destinationPin: '110001',
    chargeableWeightGrams: 500,
    declaredValueInr: '999.00',
    codAmountInr: '999.00',
    isCod: true,
    lengthCm: 10,
    widthCm: 10,
    heightCm: 10,
    orderId: 'order-1',
    ...over,
  };
}

function makeService(over: Record<string, unknown> = {}, lane?: Record<string, unknown>) {
  const estimateLane = jest.fn(async () => ({
    etdDays: 4,
    totalInr: 78.5,
    carrierName: 'Xpressbees Surface',
    fromLiveApi: true,
    ...lane,
  }));
  const fetchPod = jest.fn(async () => ({ url: 'https://sr/pod.pdf', message: null }));
  const delhiveryTat = jest.fn();
  const delhiveryCost = jest.fn();
  const delhiveryDoc = jest.fn();

  const svc = new CourierShipmentInsightService(
    { resolve: jest.fn(async () => ctx(over)) } as unknown as ShipmentCourierContextService,
    { expectedTat: delhiveryTat } as unknown as DelhiveryTatService,
    { estimate: delhiveryCost } as unknown as DelhiveryCostService,
    { fetch: delhiveryDoc } as unknown as DelhiveryDocumentService,
    { estimateLane, fetchPod } as unknown as ShiprocketClientService,
  );
  return { svc, estimateLane, fetchPod, delhiveryTat, delhiveryCost, delhiveryDoc };
}

describe('CourierShipmentInsightService — Shiprocket parcels', () => {
  it('answers time AND cost from their single call, never asking Delhivery', async () => {
    const { svc, estimateLane, delhiveryTat, delhiveryCost } = makeService();
    const r = await svc.insight('staff-1', 'ship-1');

    expect(estimateLane).toHaveBeenCalledTimes(1);
    // Asking Delhivery to price a parcel Shiprocket is carrying would
    // return a number we will never be billed.
    expect(delhiveryTat).not.toHaveBeenCalled();
    expect(delhiveryCost).not.toHaveBeenCalled();

    expect(r.tat?.tatDays).toBe(4);
    // Money is a string everywhere else; a number here would round
    // differently on the way to the page than every other figure on it.
    expect(r.cost?.totalInr).toBe('78.50');
  });

  it('reports an absent breakdown as null, never as zero', async () => {
    const { svc } = makeService();
    const r = await svc.insight('staff-1', 'ship-1');

    // "COD fee ₹0.00" on a COD parcel reads as measured and is
    // invented — they quote one number and itemise nothing.
    expect(r.cost?.codFeeInr).toBeNull();
    expect(r.cost?.deliveryInr).toBeNull();
    expect(r.cost?.chargedWeightGrams).toBeNull();
    // What we DID learn is which carrier they would actually use.
    expect(r.cost?.components).toEqual({ carrier: 'Xpressbees Surface' });
  });

  it('degrades to null rather than throwing when they cannot answer', async () => {
    const { svc } = makeService({}, { etdDays: null, totalInr: null, carrierName: null });
    const r = await svc.insight('staff-1', 'ship-1');
    expect(r.tat).toBeNull();
    expect(r.cost).toBeNull();
  });

  it('fetches their POD for an EPOD request', async () => {
    const { svc, fetchPod, delhiveryDoc } = makeService();
    const r = await svc.document('staff-1', 'ship-1', 'EPOD');

    expect(fetchPod).toHaveBeenCalledWith('99887', 'sr-1');
    expect(delhiveryDoc).not.toHaveBeenCalled();
    expect(r.url).toBe('https://sr/pod.pdf');
  });

  it('refuses the other three document kinds instead of returning the POD for them', async () => {
    const { svc, fetchPod } = makeService();
    const r = await svc.document('staff-1', 'ship-1', 'SIGNATURE_URL');

    // A signature image and a reverse-pickup QC photo are different
    // evidence. Handing back the wrong one labelled as the right one is
    // worse in a dispute than saying we do not have it.
    expect(fetchPod).not.toHaveBeenCalled();
    expect(r.url).toBeNull();
    expect(r.message).toContain('proof of delivery only');
  });

  it('says so plainly when the parcel carries no Shiprocket parcel id', async () => {
    const { svc, fetchPod } = makeService({ courierShipmentId: null });
    const r = await svc.document('staff-1', 'ship-1', 'EPOD');

    // Their document endpoint keys on THEIR id, not the AWB.
    expect(fetchPod).not.toHaveBeenCalled();
    expect(r.url).toBeNull();
  });
});
