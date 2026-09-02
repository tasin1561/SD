import { ActorType, ShipmentStatus } from '@skydrop/db';
import { ShipmentAddressService } from '../../src/modules/shipment-address/services/shipment-address.service';

type Any = Record<string, unknown>;

function makeSut(opts: { status?: ShipmentStatus; editOk?: boolean } = {}) {
  const shipment = {
    id: 'sh1',
    status: opts.status ?? ShipmentStatus.IN_TRANSIT,
    awbNumber: 'AWB1',
    courierCode: 'delhivery',
    courierAccountId: 'acc1',
    courierShipmentId: 'CS1',
    destRecipientName: 'Asha',
    destRecipientPhoneE164: '+919876500000',
    destAddressLine1: '2nd Floor, Prestige',
    destCity: 'Bengaluru',
    destStateProvince: 'Karnataka',
    destPostalCode: '560103',
  };
  const created: Any[] = [];
  const updated: Any[] = [];
  const prisma = {
    client: {
      orderShipment: { findFirst: async () => ({ shipment }) },
      shipmentAddressChange: {
        create: async (a: { data: Any }) => {
          created.push(a.data);
          return { id: 'chg1' };
        },
        update: async (a: { data: Any }) => {
          updated.push(a.data);
          return {};
        },
        findMany: async () => [],
      },
      shipment: { update: async () => ({}) },
      $transaction: async (ops: unknown[]) => ops,
    },
  };
  const edit = jest.fn(async (_i: Any, _a: unknown) => ({
    success: opts.editOk ?? true,
    message: opts.editOk === false ? 'refused' : null,
  }));
  const svc = new ShipmentAddressService(
    prisma as never,
    { edit } as never,
    { log: jest.fn(async () => 'a1') } as never,
  );
  return { svc, edit, created, updated };
}

const ACTOR = { type: ActorType.SELLER, sellerId: 's1' };

describe('ShipmentAddressService — correcting a moving parcel', () => {
  describe('the window the courier will accept', () => {
    it('is open while the parcel is in transit', async () => {
      const r = await makeSut({ status: ShipmentStatus.IN_TRANSIT }).svc.editability('o1', 's1');
      expect(r.editable).toBe(true);
    });

    it('is CLOSED once it is out for delivery', async () => {
      // Delhivery's "Dispatched" is our OUT_FOR_DELIVERY. A parcel on
      // the van is past the point of changing where it is going — the
      // one people most expect to work, and it does not.
      const r = await makeSut({ status: ShipmentStatus.OUT_FOR_DELIVERY }).svc.editability(
        'o1',
        's1',
      );
      expect(r.editable).toBe(false);
      expect(r.reason).toContain('on the van');
    });

    it('is closed once delivered', async () => {
      const r = await makeSut({ status: ShipmentStatus.DELIVERED }).svc.editability('o1', 's1');
      expect(r.editable).toBe(false);
    });

    it('refuses the change itself, not just the form', async () => {
      // FE-2: the greyed-out field is cosmetic; this is the boundary.
      const sut = makeSut({ status: ShipmentStatus.DELIVERED });
      await expect(
        sut.svc.change({ orderId: 'o1', sellerId: 's1', name: 'New', actor: ACTOR }),
      ).rejects.toMatchObject({ response: { code: 'COURIER_WILL_NOT_ACCEPT_CHANGES' } });
      expect(sut.edit).not.toHaveBeenCalled();
    });
  });

  describe('what reaches the courier', () => {
    it('sends only what actually differs', async () => {
      const sut = makeSut();
      await sut.svc.change({
        orderId: 'o1',
        sellerId: 's1',
        name: 'Asha', // unchanged
        phone: '+919999900000', // changed
        actor: ACTOR,
      });
      const sent = sut.edit.mock.calls[0]?.[0] as unknown as Any;
      expect(sent['phone']).toBe('+919999900000');
      // Re-sending an unchanged field asks the courier to rewrite it for
      // nothing, and would log an audit row saying something changed.
      expect(sent['name']).toBeUndefined();
    });

    it('refuses when nothing is different', async () => {
      const sut = makeSut();
      await expect(
        sut.svc.change({ orderId: 'o1', sellerId: 's1', name: 'Asha', actor: ACTOR }),
      ).rejects.toMatchObject({ response: { code: 'NOTHING_TO_CHANGE' } });
    });
  });

  describe('the audit row', () => {
    it('is written BEFORE the courier is told', async () => {
      // A crash between leaves a row saying what was ASKED with no
      // acceptance stamped — recoverable and legible. The inverse loses
      // the request while the courier acts on it.
      const sut = makeSut();
      await sut.svc.change({
        orderId: 'o1',
        sellerId: 's1',
        addressLine1: '3rd Floor, Prestige',
        actor: ACTOR,
      });
      expect(sut.created).toHaveLength(1);
      expect(sut.created[0]?.['courierAcceptedAt']).toBeUndefined();
    });

    it('keeps BEFORE as well as after', async () => {
      const sut = makeSut();
      await sut.svc.change({
        orderId: 'o1',
        sellerId: 's1',
        phone: '+919999900000',
        actor: ACTOR,
      });
      expect(sut.created[0]).toMatchObject({
        phoneBefore: '+919876500000',
        phoneAfter: '+919999900000',
      });
    });

    it('records a refusal without stamping acceptance', async () => {
      const sut = makeSut({ editOk: false });
      const r = await sut.svc.change({
        orderId: 'o1',
        sellerId: 's1',
        name: 'New Name',
        actor: ACTOR,
      });
      expect(r.accepted).toBe(false);
      const stamped = sut.updated.some((d) => 'courierAcceptedAt' in d);
      expect(stamped).toBe(false);
    });
  });
});
