import { CourierChoiceService } from '../../src/modules/courier-awb/services/courier-choice.service';
import { CourierOptionSelectionService } from '../../src/modules/courier-shared/services/courier-option-selection.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SettingsResolverService } from '../../src/modules/settings/services/settings-resolver.service';
import type { ShiprocketClientService } from '../../src/modules/courier-shiprocket/services/shiprocket-client.service';

const OPTIONS = [
  { courierCompanyId: 1, courierName: 'Cheap', rateInr: 40, estimatedDays: 6, etd: null },
  { courierCompanyId: 2, courierName: 'Quick', rateInr: 90, estimatedDays: 1, etd: null },
];

function makeSut(
  opts: {
    policy?: string;
    maxDays?: number;
    originPin?: string | null;
    settingsThrows?: boolean;
    listThrows?: boolean;
    options?: typeof OPTIONS;
  } = {},
) {
  const shipmentUpdate = jest.fn(async () => ({}));
  const client = {
    systemSetting: {
      findUnique: jest.fn(async () => ({
        valueString: opts.originPin === undefined ? '110042' : opts.originPin,
      })),
    },
    shipment: { update: shipmentUpdate },
  };
  const resolve = jest.fn(async (_sellerId: string, key: string) => {
    if (opts.settingsThrows === true) throw new Error('settings are down');
    return key === 'courier.selection_policy'
      ? {
          key,
          valueType: 'STRING',
          value: opts.policy ?? 'SHIPROCKET_DEFAULT',
          source: 'SYSTEM_DEFAULT',
        }
      : { key, valueType: 'INT', value: opts.maxDays ?? 5, source: 'SYSTEM_DEFAULT' };
  });
  const listCourierOptions = jest.fn(async () => {
    if (opts.listThrows === true) throw new Error('Shiprocket 503');
    return { options: opts.options ?? OPTIONS, fromLiveApi: true };
  });

  const svc = new CourierChoiceService(
    { client } as unknown as PrismaService,
    { resolve } as unknown as SettingsResolverService,
    { listCourierOptions } as unknown as ShiprocketClientService,
    new CourierOptionSelectionService(),
  );
  return { svc, listCourierOptions, shipmentUpdate, resolve };
}

const INPUT = {
  shipmentId: 'ship-1',
  courierCode: 'shiprocket',
  courierAccountId: 'acct-1',
  sellerId: 'seller-1',
  deliveryPincode: '560001',
  weightGrams: 500,
  isCod: true,
};

/**
 * CUR-17 — the policy layer between a confirmed order and a booking.
 *
 * Everything here is about ONE property: a fault in this layer must
 * never stop a parcel. The dangerous failure is not "we picked the
 * wrong carrier", it is "the day's dispatches stopped because a rate
 * lookup timed out".
 */
describe('CourierChoiceService', () => {
  it('a courier that IS the carrier is never asked to choose', async () => {
    const sut = makeSut({ policy: 'MANUAL' });
    await expect(sut.svc.decide({ ...INPUT, courierCode: 'delhivery' })).resolves.toMatchObject({
      kind: 'BOOK',
      courierCompanyId: null,
    });
    // And no rate call was spent finding that out.
    expect(sut.listCourierOptions).not.toHaveBeenCalled();
  });

  it('the DEFAULT policy costs no API call', async () => {
    // Fetching options nobody reads would add a live round-trip to the
    // critical path of the most common configuration.
    const sut = makeSut({ policy: 'SHIPROCKET_DEFAULT' });
    await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({ kind: 'BOOK' });
    expect(sut.listCourierOptions).not.toHaveBeenCalled();
  });

  it('CHEAPEST names the carrier on the booking', async () => {
    const sut = makeSut({ policy: 'CHEAPEST' });
    await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({
      kind: 'BOOK',
      courierCompanyId: 1,
    });
  });

  it('MANUAL pauses and carries the options with it', async () => {
    const sut = makeSut({ policy: 'MANUAL' });
    const r = await sut.svc.decide(INPUT);
    expect(r.kind).toBe('PAUSE');
    expect(r.kind === 'PAUSE' && r.options).toHaveLength(2);
  });

  it('records what was on the table, whatever it then decides', async () => {
    // Asked a week later, "why did it go by that one" is answered by
    // the list that existed at the time. Rates move.
    const sut = makeSut({ policy: 'CHEAPEST' });
    await sut.svc.decide(INPUT);
    expect(sut.shipmentUpdate).toHaveBeenCalledTimes(1);
  });

  describe('every failure books anyway', () => {
    it('the options call failing', async () => {
      const sut = makeSut({ policy: 'MANUAL', listThrows: true });
      await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({
        kind: 'BOOK',
        courierCompanyId: null,
      });
    });

    it('the settings lookup failing', async () => {
      const sut = makeSut({ policy: 'MANUAL', settingsThrows: true });
      await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({ kind: 'BOOK' });
    });

    it('no origin pincode configured', async () => {
      const sut = makeSut({ policy: 'MANUAL', originPin: null });
      await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({ kind: 'BOOK' });
    });

    it('an order with no seller to have a policy', async () => {
      const sut = makeSut({ policy: 'MANUAL' });
      await expect(sut.svc.decide({ ...INPUT, sellerId: null })).resolves.toMatchObject({
        kind: 'BOOK',
      });
    });

    it('a policy value that is not a policy', async () => {
      // A typo in a settings row must not strand a parcel, and must
      // not silently become MANUAL — the one value that stops things.
      const sut = makeSut({ policy: 'CHEEPEST' });
      await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({
        kind: 'BOOK',
        courierCompanyId: null,
      });
    });

    it('recording the options failing', async () => {
      const sut = makeSut({ policy: 'CHEAPEST' });
      sut.shipmentUpdate.mockRejectedValueOnce(new Error('db is busy'));
      await expect(sut.svc.decide(INPUT)).resolves.toMatchObject({ kind: 'BOOK' });
    });
  });
});
