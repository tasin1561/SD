import { ActorType } from '@skydrop/db';
import { ReversePickupBookingService } from '../../src/modules/customer-return/services/reverse-pickup-booking.service';

type Any = Record<string, unknown>;

function makeSut(
  opts: {
    shipment?: Any | null;
    claimCount?: number;
    generate?: Any;
    generateThrows?: boolean;
  } = {},
) {
  const shipment = {
    id: 'sh1',
    shipmentNumber: 'SH-1',
    courierCode: 'delhivery',
    courierAccountId: 'acc1',
    reverseAwbNumber: null,
    reverseAwbRequestedAt: null,
    destRecipientName: 'Asha',
    destRecipientPhoneE164: '+919876500000',
    destAddressLine1: '2nd Floor',
    destAddressLine2: 'Near the bridge',
    destCity: 'Bengaluru',
    destStateProvince: 'Karnataka',
    destPostalCode: '560103',
    destCountryCode: 'IN',
    totalWeightGrams: 250,
    declaredValueInr: '999',
    lengthCm: '15',
    widthCm: '5',
    heightCm: '5',
    ...(opts.shipment ?? {}),
  };

  const updateMany = jest.fn(async (_a: { where: Any; data: Any }) => ({
    count: opts.claimCount ?? 1,
  }));
  const update = jest.fn(async (_a: { where: Any; data: Any }) => ({}));
  const prisma = {
    client: {
      orderShipment: {
        findFirst: async () => (opts.shipment === null ? null : { shipment }),
      },
      shipment: { updateMany, update },
    },
  };

  const generate = jest.fn(async (_req: Any, _actor: unknown) => {
    if (opts.generateThrows === true) throw new Error('connection reset');
    return (
      opts.generate ?? {
        ok: true,
        awbNumber: 'RVP-1',
        courierShipmentId: 'CS-1',
        serviceable: true,
        errorCode: null,
        errorMessage: null,
      }
    );
  });
  const raise = jest.fn(async () => null);

  const svc = new ReversePickupBookingService(
    prisma as never,
    { generate } as never,
    { log: jest.fn(async () => 'a1') } as never,
    { raise } as never,
  );
  return { svc, updateMany, update, generate, raise };
}

const INPUT = {
  orderId: 'o1',
  sellerId: 's1',
  actor: { type: ActorType.STAFF, staffId: 'staff1' },
};

describe('ReversePickupBookingService — this sends a van', () => {
  it('books a REVERSE, not another delivery', async () => {
    const sut = makeSut();
    const r = await sut.svc.book(INPUT);

    expect(r.booked).toBe(true);
    expect(r.awbNumber).toBe('RVP-1');
    const req = sut.generate.mock.calls[0]?.[0] as unknown as {
      isReverse: boolean;
      codAmountInr: string | null;
    };
    expect(req.isReverse).toBe(true);
    // A return collects nothing. Sending the forward COD would ask the
    // customer to pay for their own return.
    expect(req.codAmountInr).toBeNull();
  });

  it('CLAIMS before it calls, guarded on nothing being claimed yet', async () => {
    const sut = makeSut();
    await sut.svc.book(INPUT);
    const where = sut.updateMany.mock.calls[0]?.[0] as unknown as { where: Any };
    expect(where.where).toMatchObject({
      id: 'sh1',
      reverseAwbRequestedAt: null,
      reverseAwbNumber: null,
    });
  });

  it('refuses when the claim is already taken — one parcel, one van', async () => {
    const sut = makeSut({ claimCount: 0 });
    const r = await sut.svc.book(INPUT);
    expect(r.booked).toBe(false);
    expect(r.alreadyBooked).toBe(true);
    expect(sut.generate).not.toHaveBeenCalled();
  });

  it('is idempotent once a waybill exists — a retry is not a second collection', async () => {
    const sut = makeSut({ shipment: { reverseAwbNumber: 'RVP-EXISTING' } });
    const r = await sut.svc.book(INPUT);
    expect(r.alreadyBooked).toBe(true);
    expect(r.awbNumber).toBe('RVP-EXISTING');
    expect(sut.generate).not.toHaveBeenCalled();
  });

  it('KEEPS the claim when the courier refuses, and asks for a person', async () => {
    // We cannot tell "they never got it" from "the reply was lost", and
    // the two want opposite responses. Freeing the claim would let a
    // retry send a second van.
    const sut = makeSut({
      generate: {
        ok: false,
        awbNumber: null,
        courierShipmentId: null,
        serviceable: false,
        errorCode: 'NON_SERVICEABLE',
        errorMessage: 'Pincode not serviceable for reverse',
      },
    });
    const r = await sut.svc.book(INPUT);

    expect(r.booked).toBe(false);
    // No call clearing reverseAwbRequestedAt.
    const cleared = sut.update.mock.calls.some((c) => {
      const data = (c[0] as unknown as { data: Any }).data;
      return 'reverseAwbRequestedAt' in data && data['reverseAwbRequestedAt'] === null;
    });
    expect(cleared).toBe(false);
    expect(sut.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'reverse-pickup-failed:sh1' }),
    );
  });

  it('treats a thrown error the same way — a lost reply is not a refusal', async () => {
    const sut = makeSut({ generateThrows: true });
    const r = await sut.svc.book(INPUT);
    expect(r.booked).toBe(false);
    expect(sut.raise).toHaveBeenCalled();
  });

  it('persists the waybill immediately — it is the only record a van is coming', async () => {
    const sut = makeSut();
    await sut.svc.book(INPUT);
    const persisted = sut.update.mock.calls.find((c) => {
      const data = (c[0] as unknown as { data: Any }).data;
      return data['reverseAwbNumber'] === 'RVP-1';
    });
    expect(persisted).toBeDefined();
  });
});
