import { ActorType } from '@skydrop/db';
import { CourierOpsDispatchService } from '../../src/modules/courier-ops/services/courier-ops-dispatch.service';
import type { DelhiveryShipmentEditService } from '../../src/modules/courier-delhivery/services/delhivery-shipment-edit.service';
import type { DelhiveryPickupService } from '../../src/modules/courier-delhivery/services/delhivery-pickup.service';
import type { DelhiveryWarehouseService } from '../../src/modules/courier-delhivery/services/delhivery-warehouse.service';
import type { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';

const ACTOR = { type: ActorType.SYSTEM };

function makeService(
  opts: { srPickup?: (id: string) => { ok: boolean; message: string | null } } = {},
) {
  const dlCancel = jest.fn(async () => ({
    success: true,
    awbNumber: 'A',
    message: null,
    raw: null,
  }));
  const dlPickup = jest.fn(async () => ({
    success: true,
    pickupId: 'PU-1',
    message: null,
    raw: null,
  }));
  const dlWarehouse = jest.fn(async () => ({
    success: true,
    name: 'BLR',
    message: null,
    raw: null,
  }));
  const srCancel = jest.fn(async () => ({ ok: true, message: null }));
  const srPickup = jest.fn(async (id: string) =>
    opts.srPickup ? opts.srPickup(id) : { ok: true, message: null },
  );
  const srWarehouse = jest.fn(async () => ({ success: true, name: 'BLR', message: null }));

  const svc = new CourierOpsDispatchService(
    { cancel: dlCancel } as unknown as DelhiveryShipmentEditService,
    { requestPickup: dlPickup } as unknown as DelhiveryPickupService,
    { register: dlWarehouse, update: dlWarehouse } as unknown as DelhiveryWarehouseService,
    {
      cancelShipment: srCancel,
      requestPickup: srPickup,
      registerPickupLocation: srWarehouse,
    } as unknown as ShiprocketClientService,
  );
  return { svc, dlCancel, dlPickup, dlWarehouse, srCancel, srPickup, srWarehouse };
}

function pickupInput(over: Record<string, unknown> = {}) {
  return {
    courierCode: 'delhivery',
    courierAccountId: null,
    pickupLocation: 'Bengaluru WH',
    pickupDate: '2026-09-01',
    pickupTime: '15:00:00',
    expectedPackageCount: 3,
    courierShipmentIds: [],
    ...over,
  } as Parameters<CourierOpsDispatchService['requestPickup']>[0];
}

describe('CourierOpsDispatchService', () => {
  it('cancels at whichever courier has the parcel', async () => {
    const { svc, dlCancel, srCancel } = makeService();

    await svc.cancel('delhivery', null, 'DLV1', ACTOR);
    expect(dlCancel).toHaveBeenCalledTimes(1);
    expect(srCancel).not.toHaveBeenCalled();

    await svc.cancel('shiprocket', 'sr-1', 'SR1', ACTOR);
    expect(srCancel).toHaveBeenCalledWith('SR1', 'sr-1');
  });

  it('refuses a Shiprocket cancel with no account rather than guessing one', async () => {
    const { svc, srCancel } = makeService();
    const r = await svc.cancel('shiprocket', null, 'SR1', ACTOR);
    expect(srCancel).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });

  it('Delhivery pickup is ONE call for the location and day', async () => {
    const { svc, dlPickup } = makeService();
    const r = await svc.requestPickup(pickupInput(), ACTOR);

    expect(dlPickup).toHaveBeenCalledTimes(1);
    expect(r.pickupId).toBe('PU-1');
    // Their one request covers everything waiting there.
    expect(r.scheduled).toBe(3);
  });

  it('Shiprocket pickup is one call PER PARCEL, and counts them', async () => {
    const { svc, srPickup } = makeService();
    const r = await svc.requestPickup(
      pickupInput({
        courierCode: 'shiprocket',
        courierAccountId: 'sr-1',
        courierShipmentIds: ['1', '2', '3'],
      }),
      ACTOR,
    );

    expect(srPickup).toHaveBeenCalledTimes(3);
    expect(r.scheduled).toBe(3);
    expect(r.failed).toBe(0);
    // They have no per-location pickup id to record.
    expect(r.pickupId).toBeNull();
  });

  it('reports a PARTIAL Shiprocket pickup honestly instead of as a boolean', async () => {
    const { svc } = makeService({
      srPickup: (id) =>
        id === '2' ? { ok: false, message: 'already scheduled' } : { ok: true, message: null },
    });
    const r = await svc.requestPickup(
      pickupInput({
        courierCode: 'shiprocket',
        courierAccountId: 'sr-1',
        courierShipmentIds: ['1', '2', '3'],
      }),
      ACTOR,
    );

    // A van IS coming, which is what the pickup row records — but two
    // of three is a real state an operator has to be able to see, and
    // collapsing it to "success" would hide a parcel left behind.
    expect(r.success).toBe(true);
    expect(r.scheduled).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.message).toContain('2 scheduled, 1 failed');
  });

  it('one parcel throwing does not lose the rest of the day’s collection', async () => {
    const { svc } = makeService({
      srPickup: (id) => {
        if (id === '1') throw new Error('shiprocket 500');
        return { ok: true, message: null };
      },
    });
    const r = await svc.requestPickup(
      pickupInput({
        courierCode: 'shiprocket',
        courierAccountId: 'sr-1',
        courierShipmentIds: ['1', '2'],
      }),
      ACTOR,
    );
    expect(r.scheduled).toBe(1);
    expect(r.failed).toBe(1);
  });

  it('registers a pickup location with the named courier', async () => {
    const { svc, dlWarehouse, srWarehouse } = makeService();
    const input = {
      courierAccountId: 'acc-1',
      name: 'Bengaluru WH',
      phone: '+919876543210',
      pin: '560001',
      address: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      email: 'wh@skydrop.online',
      returnAddress: '12 MG Road',
    };

    await svc.registerWarehouse({ ...input, courierCode: 'delhivery' }, ACTOR);
    expect(dlWarehouse).toHaveBeenCalledTimes(1);

    await svc.registerWarehouse({ ...input, courierCode: 'shiprocket' }, ACTOR);
    // Each courier keeps its own list and neither can see the other's,
    // so a building known to both must be registered with both.
    expect(srWarehouse).toHaveBeenCalledTimes(1);
  });

  it('a manual courier is refused with something an operator can act on', async () => {
    const { svc, dlCancel, srCancel } = makeService();
    const r = await svc.cancel('bluedart', null, 'BD1', ACTOR);
    expect(dlCancel).not.toHaveBeenCalled();
    expect(srCancel).not.toHaveBeenCalled();
    expect(r.message).toContain('by hand');
  });
});

describe('CourierOpsDispatchService — editing a live parcel', () => {
  function withEdit() {
    const dlEdit = jest.fn(async () => ({
      success: true,
      awbNumber: 'A',
      message: null,
      raw: null,
    }));
    const srEdit = jest.fn<
      Promise<{ ok: boolean; message: string | null }>,
      [{ courierShipmentId: string }, string]
    >(async () => ({ ok: true, message: null }));
    const svc = new CourierOpsDispatchService(
      { cancel: jest.fn(), edit: dlEdit } as unknown as DelhiveryShipmentEditService,
      { requestPickup: jest.fn() } as unknown as DelhiveryPickupService,
      { register: jest.fn() } as unknown as DelhiveryWarehouseService,
      { editShipment: srEdit } as unknown as ShiprocketClientService,
    );
    return { svc, dlEdit, srEdit };
  }

  const base = {
    courierAccountId: 'acc-1',
    courierShipmentId: '99887',
    awbNumber: 'AWB1',
    address: '14 MG Road, near the water tank',
  };

  it('edits at whichever courier has the parcel', async () => {
    const { svc, dlEdit, srEdit } = withEdit();

    await svc.edit({ ...base, courierCode: 'delhivery' }, ACTOR);
    expect(dlEdit).toHaveBeenCalledTimes(1);

    await svc.edit({ ...base, courierCode: 'shiprocket' }, ACTOR);
    expect(srEdit).toHaveBeenCalledTimes(1);
    // Their endpoint keys on THEIR order id, not the AWB.
    expect(srEdit.mock.calls[0]?.[0].courierShipmentId).toBe('99887');
  });

  it('refuses a product-description change on Shiprocket rather than dropping it', async () => {
    const { svc, srEdit } = withEdit();
    const r = await svc.edit(
      { ...base, courierCode: 'shiprocket', productsDesc: 'Two widgets' },
      ACTOR,
    );

    // Sending the edit without it would report success while the one
    // field the operator cared about was silently discarded.
    expect(srEdit).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.message).toContain('product description');
  });

  it('refuses a Shiprocket edit with no parcel id, without calling them', async () => {
    const { svc, srEdit } = withEdit();
    const r = await svc.edit(
      { ...base, courierCode: 'shiprocket', courierShipmentId: null },
      ACTOR,
    );
    expect(srEdit).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
  });
});
