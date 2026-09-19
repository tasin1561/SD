import { ConflictException } from '@nestjs/common';
import { CourierOpsDispatchService } from '../../src/modules/courier-ops/services/courier-ops-dispatch.service';
import { ShipmentAddressService } from '../../src/modules/shipment-address/services/shipment-address.service';
import { ActorType, ShipmentStatus } from '@skydrop/db';

/**
 * The 2026-09-19 courier audit, pinned.
 *
 * Every case here is a place where ONE courier's integration was reached
 * for a parcel carried by ANOTHER — a class of bug that never throws,
 * because the wrong courier's API answers something, and is recorded in
 * our own audit as a success.
 */

function dispatcher(over: Partial<Record<string, unknown>> = {}): CourierOpsDispatchService {
  const delhiveryEwaybill = {
    update: jest.fn().mockResolvedValue({ success: true, message: 'ok' }),
  };
  const svc = new CourierOpsDispatchService(
    { cancel: jest.fn(), edit: jest.fn() } as never,
    delhiveryEwaybill as never,
    { requestPickup: jest.fn() } as never,
    { register: jest.fn() } as never,
    {} as never,
    { isStubMode: jest.fn().mockResolvedValue(false) } as never,
    { isStubMode: jest.fn().mockResolvedValue(false) } as never,
    { isProduction: true } as never,
  );
  Object.assign(svc, over);
  // Handed back so a test can assert the adapter was NOT reached.
  (svc as unknown as { __ewaybill: typeof delhiveryEwaybill }).__ewaybill = delhiveryEwaybill;
  return svc;
}

function ewaybillSpy(svc: CourierOpsDispatchService): { update: jest.Mock } {
  return (svc as unknown as { __ewaybill: { update: jest.Mock } }).__ewaybill;
}

describe('an e-way bill never goes to a courier that did not issue the waybill', () => {
  const actor = { type: ActorType.STAFF, id: 'staff-1' };

  it('reaches Delhivery for a Delhivery parcel', async () => {
    const svc = dispatcher();
    const r = await svc.attachEwaybill(
      {
        courierCode: 'delhivery',
        awbNumber: 'DL1',
        invoiceNumber: 'INV-1',
        ewaybillNumber: 'EWB-1',
      },
      actor as never,
    );
    expect(r.success).toBe(true);
    expect(ewaybillSpy(svc).update).toHaveBeenCalledTimes(1);
  });

  /**
   * THE BUG. `CourierShipmentActionService.attachEwaybill` called
   * Delhivery's endpoint with no courier branch at all, so a Shiprocket
   * parcel's number was sent to DELHIVERY'S account under a waybill
   * Delhivery never issued — a live write against the wrong carrier,
   * audited as a success.
   */
  it('REFUSES a Shiprocket parcel by name, and does not touch Delhivery', async () => {
    const svc = dispatcher();
    const r = await svc.attachEwaybill(
      {
        courierCode: 'shiprocket',
        awbNumber: 'SR1',
        invoiceNumber: 'INV-1',
        ewaybillNumber: 'EWB-1',
      },
      actor as never,
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/Shiprocket/);
    expect(ewaybillSpy(svc).update).not.toHaveBeenCalled();
  });

  it('refuses a manual parcel, and does not touch Delhivery', async () => {
    const svc = dispatcher();
    const r = await svc.attachEwaybill(
      { courierCode: 'manual', awbNumber: 'M1', invoiceNumber: 'I', ewaybillNumber: 'E' },
      actor as never,
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/booked by hand/);
    expect(ewaybillSpy(svc).update).not.toHaveBeenCalled();
  });
});

describe('the dispatcher owns the two pickup asymmetries', () => {
  const svc = dispatcher();

  it('only Delhivery needs a registered location NAME', () => {
    // Shiprocket's generate/pickup takes shipment ids and nothing else,
    // so demanding a name there refused a pickup that would have worked.
    expect(svc.pickupNeedsLocationName('delhivery')).toBe(true);
    expect(svc.pickupNeedsLocationName('shiprocket')).toBe(false);
  });

  it('only Shiprocket schedules per PARCEL', () => {
    expect(svc.pickupSchedulesPerParcel('shiprocket')).toBe(true);
    expect(svc.pickupSchedulesPerParcel('delhivery')).toBe(false);
  });

  it('names every courier whose van can be asked for', () => {
    expect([...svc.pickupCourierCodes()].sort()).toEqual(['delhivery', 'shiprocket']);
    expect(svc.pickupCourierCodes()).not.toContain('manual');
  });
});

describe('a STUB may not confirm a real address change (CUR-15)', () => {
  function addressService(opts: {
    stubbed: boolean;
    edit?: jest.Mock;
  }): { svc: ShipmentAddressService; created: jest.Mock; edit: jest.Mock } {
    const created = jest.fn().mockResolvedValue({ id: 'chg-1' });
    const edit = opts.edit ?? jest.fn().mockResolvedValue({ success: true, message: null });
    const prisma = {
      client: {
        orderShipment: {
          findFirst: jest.fn().mockResolvedValue({
            shipment: {
              id: 'sh-1',
              status: ShipmentStatus.IN_TRANSIT,
              awbNumber: 'SR-1',
              courierCode: 'shiprocket',
              courierAccountId: 'acc-1',
              courierShipmentId: 'csid',
              courierOrderId: 'coid',
              destRecipientName: 'Old Name',
              destRecipientPhoneE164: '+919000000000',
              destAddressLine1: 'Old line',
              destAddressLine2: null,
              destCity: 'Pune',
              destStateProvince: 'MH',
              destPostalCode: '411001',
            },
          }),
        },
        shipmentAddressChange: { create: created, update: jest.fn() },
        shipment: { update: jest.fn() },
        order: { update: jest.fn() },
        $transaction: jest.fn().mockResolvedValue([]),
      },
    };
    // Constructor order: prisma, the OPS DISPATCHER, audit, notifier.
    const svc = new ShipmentAddressService(
      prisma as never,
      {
        edit,
        isStubbedInProduction: jest.fn().mockResolvedValue(opts.stubbed),
      } as never,
      { log: jest.fn() } as never,
      { orderChanged: jest.fn(), customerChanged: jest.fn() } as never,
    );
    return { svc, created, edit };
  }

  /**
   * THE BUG, and the most consequential one in the audit.
   *
   * Both adapters return `{success: true, message: 'stub'}` BEFORE the
   * write guard runs. With a courier stubbed in production, a seller's
   * or a store's correction was reported ACCEPTED and the new address
   * was written to the change row, the shipment AND the order — while
   * the courier had never heard of it. The driver kept the old address
   * and every screen agreed with every other screen.
   */
  it('refuses BY NAME, and writes nothing at all', async () => {
    const { svc, created, edit } = addressService({ stubbed: true });
    await expect(
      svc.change({
        orderId: 'ord-1',
        sellerId: 'sel-1',
        addressLine1: 'New line',
        actor: { type: ActorType.SELLER, sellerId: 'sel-1' },
      }),
    ).rejects.toThrow(ConflictException);

    // BEFORE the record, not after it: a row saying what was asked is
    // only useful when something was actually asked.
    expect(created).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('lets a live courier through unchanged', async () => {
    const { svc, created, edit } = addressService({ stubbed: false });
    await svc.change({
      orderId: 'ord-1',
      sellerId: 'sel-1',
      addressLine1: 'New line',
      actor: { type: ActorType.SELLER, sellerId: 'sel-1' },
    });
    expect(created).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
