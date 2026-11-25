import { OrderStatus, SupersedeReason } from '@skydrop/db';
import { CourierDecisionService } from '../../src/modules/courier-awb/services/courier-decision.service';

/**
 * Owner, 2026-11-25: two Shiprocket parcels booked by a failover with the
 * courier's own carrier go BACK to the decision desk. Each refusal guards
 * a real-world cost: a live waybill stays charged, a packed box already
 * carries a label, an order past CONFIRMED is already moving.
 */
const OLD = {
  id: 'old-1',
  shipmentNumber: 'SH-2026-11-000286',
  courierCode: 'shiprocket',
  courierAccountId: 'sr-acc',
  awbNumber: 'SRSC8063817617',
  courierCancelledAt: new Date(),
  packCompletedAt: null,
  handoverScannedAt: null,
  supersededAt: null,
  destPostalCode: '743370',
  totalWeightGrams: 170,
  codAmountInr: '1100',
  orderShipments: [{ orderId: 'ord-1', order: { status: OrderStatus.CONFIRMED, sellerId: 's1' } }],
};

function make(over: Partial<typeof OLD> = {}, decision: unknown = null) {
  const shipmentUpdate = jest.fn(async () => ({}));
  const prisma = {
    client: {
      shipment: { findUnique: jest.fn(async () => ({ ...OLD, ...over })), update: shipmentUpdate },
    },
  };
  const audit = { log: jest.fn(async () => 'a') };
  const transitionStatus = jest.fn(async () => ({}));
  const processOrder = jest.fn(async () => ({ result: 'GENERATED' }));
  const supersede = {
    supersede: jest.fn(async () => ({ newShipmentId: 'new-1', newShipmentNumber: 'SH-X' })),
  };
  const decide = jest.fn(
    async () => decision ?? { kind: 'PAUSE', options: [{}, {}, {}], why: 'policy is MANUAL' },
  );
  const svc = new CourierDecisionService(
    prisma as never,
    audit as never,
    { transitionStatus } as never,
    { processOrder } as never,
    {} as never,
    {} as never,
    {} as never,
    supersede as never,
    { decide } as never,
  );
  return { svc, shipmentUpdate, transitionStatus, processOrder, supersede, decide, audit };
}

const send = (svc: CourierDecisionService) =>
  svc.sendBackForChoice({ shipmentId: 'old-1', staffId: 'staff-1' });

describe('send a booked Shiprocket parcel back for a carrier choice', () => {
  it('retires the old record, quotes again, and pauses the order at AWAITING_COURIER', async () => {
    const { svc, supersede, decide, transitionStatus, shipmentUpdate, audit } = make();
    await expect(send(svc)).resolves.toEqual({
      orderId: 'ord-1',
      newShipmentId: 'new-1',
      options: 3,
    });
    expect(supersede.supersede).toHaveBeenCalledWith(
      'old-1',
      SupersedeReason.MANUAL_REPLACEMENT,
      expect.objectContaining({ id: 'staff-1' }),
    );
    expect(shipmentUpdate).toHaveBeenCalledWith({
      where: { id: 'new-1' },
      data: { courierAccountId: 'sr-acc' },
    });
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        shipmentId: 'new-1',
        courierCode: 'shiprocket',
        chosenCourierCompanyId: null,
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        to: OrderStatus.AWAITING_COURIER,
        expectedFrom: OrderStatus.CONFIRMED,
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier_decision.sent_back' }),
    );
  });

  it.each([
    ['a waybill still live with the courier', { courierCancelledAt: null }, 'WAYBILL_STILL_LIVE'],
    ['a packed parcel', { packCompletedAt: new Date() }, 'PARCEL_ALREADY_PACKED'],
    ['a parcel already replaced', { supersededAt: new Date() }, 'SHIPMENT_SUPERSEDED'],
    [
      'an order past CONFIRMED',
      {
        orderShipments: [
          { orderId: 'ord-1', order: { status: OrderStatus.PACKED, sellerId: 's1' } },
        ],
      },
      'ORDER_NOT_CONFIRMED',
    ],
  ])('refuses %s, and changes nothing', async (_name, over, code) => {
    const { svc, supersede, transitionStatus } = make(over as never);
    await expect(send(svc)).rejects.toMatchObject({ response: { code } });
    expect(supersede.supersede).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('nothing to choose (not an aggregator, or the policy would not ask) → refused before any change', async () => {
    const { svc, supersede, processOrder, transitionStatus } = make(
      {},
      { kind: 'BOOK', courierCompanyId: null, why: 'this courier is the carrier' },
    );
    await expect(send(svc)).rejects.toMatchObject({ response: { code: 'NO_CARRIER_CHOICE' } });
    expect(supersede.supersede).not.toHaveBeenCalled();
    expect(processOrder).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});
