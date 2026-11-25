import { OrderStatus } from '@skydrop/db';
import { CourierDecisionService } from '../../src/modules/courier-awb/services/courier-decision.service';

/**
 * Owner, 2026-11-25: a parcel waiting on the decision desk can go to
 * manual placement instead of taking the only carrier on offer. Status
 * move only — no courier call, no supersede.
 */
const WAITING = {
  id: 'sh-1',
  shipmentNumber: 'SH-2026-11-000300',
  supersededAt: null as Date | null,
  awbNumber: null as string | null,
  orderShipments: [{ orderId: 'ord-1', order: { status: OrderStatus.AWAITING_COURIER } }],
};

function make(over: Partial<typeof WAITING> = {}) {
  const prisma = {
    client: { shipment: { findUnique: jest.fn(async () => ({ ...WAITING, ...over })) } },
  };
  const audit = { log: jest.fn(async () => 'a') };
  const transitionStatus = jest.fn(async () => ({}));
  const processOrder = jest.fn();
  const supersede = { supersede: jest.fn() };
  const svc = new CourierDecisionService(
    prisma as never,
    audit as never,
    { transitionStatus } as never,
    { processOrder } as never,
    {} as never,
    {} as never,
    {} as never,
    supersede as never,
    {} as never,
  );
  return { svc, audit, transitionStatus, processOrder, supersede };
}

const send = (svc: CourierDecisionService) =>
  svc.sendToManualPlacement({ shipmentId: 'sh-1', staffId: 'staff-1' });

describe('send a waiting parcel to manual placement', () => {
  it('moves AWAITING_COURIER → PENDING_MANUAL_PLACEMENT, books nothing, audits', async () => {
    const { svc, audit, transitionStatus, processOrder, supersede } = make();
    await expect(send(svc)).resolves.toEqual({ orderId: 'ord-1' });
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        to: OrderStatus.PENDING_MANUAL_PLACEMENT,
        expectedFrom: OrderStatus.AWAITING_COURIER,
        actor: { type: 'STAFF', id: 'staff-1' },
      }),
    );
    expect(processOrder).not.toHaveBeenCalled();
    expect(supersede.supersede).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier_decision.sent_to_manual' }),
    );
  });

  it.each([
    ['a parcel that already has a waybill', { awbNumber: 'X1' }, 'AWB_ALREADY_GENERATED'],
    ['a retired parcel', { supersededAt: new Date() }, 'SHIPMENT_SUPERSEDED'],
    [
      'an order no longer waiting',
      { orderShipments: [{ orderId: 'ord-1', order: { status: OrderStatus.CONFIRMED } }] },
      'ORDER_NOT_AWAITING_COURIER',
    ],
    ['a parcel with no order', { orderShipments: [] }, 'SHIPMENT_HAS_NO_ORDER'],
  ])('refuses %s and changes nothing', async (_n, over, code) => {
    const { svc, transitionStatus } = make(over as never);
    await expect(send(svc)).rejects.toMatchObject({ response: { code } });
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});
