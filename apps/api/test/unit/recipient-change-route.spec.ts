import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import {
  COURIER_EDITABLE_SHIPMENT_STATUSES,
  recipientChangeRoute,
} from '../../src/modules/order/recipient-change-route';

/**
 * WHO may change where a parcel is going (owner decision 3, 2026-09-18).
 *
 * The rule under test is that the answer is a FACT — does anybody outside
 * this building already hold this address — and not a list of order
 * statuses. A waybill is that fact.
 */
describe('recipientChangeRoute (2026-09-18)', () => {
  const live = (status: ShipmentStatus, awbNumber: string | null) => ({ status, awbNumber });

  it('no parcel at all: ours to write', () => {
    expect(
      recipientChangeRoute({
        orderStatus: OrderStatus.PENDING_CONFIRMATION,
        isTerminal: false,
        liveShipment: null,
      }),
    ).toEqual({ kind: 'DIRECT' });
  });

  it('a parcel with NO waybill is ours to write, whatever the order status says', () => {
    // AWAITING_COURIER, and a CONFIRMED order whose AWB job has not run
    // yet, both sit here. Nobody outside has the address, so changing our
    // row IS changing where it goes.
    expect(
      recipientChangeRoute({
        orderStatus: OrderStatus.AWAITING_COURIER,
        isTerminal: false,
        liveShipment: live(ShipmentStatus.CREATED, null),
      }),
    ).toEqual({ kind: 'DIRECT' });
    expect(
      recipientChangeRoute({
        orderStatus: OrderStatus.CONFIRMED,
        isTerminal: false,
        liveShipment: live(ShipmentStatus.CREATED, '   '),
      }),
    ).toEqual({ kind: 'DIRECT' });
  });

  it('a waybill means the COURIER decides, and says whether they still will', () => {
    const inWindow = recipientChangeRoute({
      orderStatus: OrderStatus.IN_TRANSIT,
      isTerminal: false,
      liveShipment: live(ShipmentStatus.IN_TRANSIT, 'AWB1'),
    });
    expect(inWindow).toMatchObject({ kind: 'COURIER', courierWillAccept: true });

    // Their "Dispatched" is OUR OUT_FOR_DELIVERY — on the van, past the
    // point of redirecting, and the one everybody gets wrong.
    const onTheVan = recipientChangeRoute({
      orderStatus: OrderStatus.OUT_FOR_DELIVERY,
      isTerminal: false,
      liveShipment: live(ShipmentStatus.OUT_FOR_DELIVERY, 'AWB1'),
    });
    expect(onTheVan).toMatchObject({ kind: 'COURIER', courierWillAccept: false });
    expect((onTheVan as { reason: string }).reason).toContain('on the van');
  });

  it('a finished order has no parcel to redirect', () => {
    expect(
      recipientChangeRoute({
        orderStatus: OrderStatus.DELIVERED,
        isTerminal: true,
        liveShipment: live(ShipmentStatus.DELIVERED, 'AWB1'),
      }),
    ).toMatchObject({ kind: 'REFUSED' });
  });

  it('the courier window is declared ONCE and `shipment-address` reads it', () => {
    // Two lists that must agree about a fact neither owns is how they
    // come to disagree. The surviving copy is beside the routing
    // decision; this pins that the service imports it rather than
    // declaring its own again.
    const src = readFileSync(
      join(__dirname, '../../src/modules/shipment-address/services/shipment-address.service.ts'),
      'utf8',
    );
    expect(src).toContain('COURIER_EDITABLE_SHIPMENT_STATUSES');
    expect(src).not.toMatch(/const EDITABLE_STATUSES:\s*ReadonlySet<ShipmentStatus>\s*=\s*new Set/);
    expect(COURIER_EDITABLE_SHIPMENT_STATUSES.has(ShipmentStatus.OUT_FOR_DELIVERY)).toBe(false);
  });
});
