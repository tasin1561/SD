import { ShipmentProvisionService } from '../../src/modules/shipment-provision/services/shipment-provision.service';

function make(rows: unknown[]) {
  const findMany = jest.fn(async () => rows);
  const svc = new ShipmentProvisionService(
    { client: { orderShipment: { findMany } } } as never,
    {} as never,
    {} as never,
  );
  return { svc, findMany };
}

const dec = (n: number) => ({ toNumber: () => n });
const ship = (over: Record<string, unknown>) => ({
  awbNumber: 'AWB1',
  courierCode: 'delhivery',
  manualCourierName: null,
  courier: { displayName: 'Delhivery' },
  totalWeightGrams: 500,
  declaredWeightGrams: null,
  actualWeightGrams: null,
  lengthCm: dec(10),
  widthCm: dec(8),
  heightCm: null,
  ...over,
});

describe('ShipmentProvisionService.summariesForOrders', () => {
  it('is ONE query for the whole page, and none for an empty page', async () => {
    const { svc, findMany } = make([]);
    await svc.summariesForOrders([]);
    expect(findMany).not.toHaveBeenCalled();
    await svc.summariesForOrders(['a', 'b', 'c']);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest parcel, prefers actual weight, leaves absent orders out', async () => {
    const { svc } = make([
      { orderId: 'a', shipment: ship({ awbNumber: 'OLD' }) },
      { orderId: 'a', shipment: ship({ awbNumber: 'NEW', actualWeightGrams: 650 }) },
    ]);
    const m = await svc.summariesForOrders(['a', 'b']);
    expect(m.get('a')).toMatchObject({
      awbNumber: 'NEW',
      weightGrams: 650,
      lengthCm: 10,
      heightCm: null,
      courierDisplayName: 'Delhivery',
    });
    expect(m.has('b')).toBe(false);
  });

  it('carries the manual courier name beside the literal manual code (CUR-8)', async () => {
    const { svc } = make([
      {
        orderId: 'a',
        shipment: ship({
          courierCode: 'manual',
          manualCourierName: 'Pathao',
          courier: { displayName: 'Manual' },
        }),
      },
    ]);
    const s = (await svc.summariesForOrders(['a'])).get('a');
    expect(s?.manualCourierName).toBe('Pathao');
  });
});
