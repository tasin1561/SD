import { NotFoundException } from '@nestjs/common';
import { OrderStatus, ShipmentStatus } from '@skydrop/db';
import { PackService } from '../../src/modules/warehouse-pack/services/pack.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { OrderReadService } from '../../src/modules/order/services/order-read.service';
import type { OrderWriteService } from '../../src/modules/order/services/order-write.service';
import type { ManifestService } from '../../src/modules/warehouse-manifest/services/manifest.service';

type AnyArgs = Record<string, unknown>;

const SHIP = 'ship-1';
const ORDER = 'order-1';
const STAFF = 'staff-1';

function makeService(
  opts: {
    shipment?: AnyArgs | null;
    orderStatus?: OrderStatus | 'missing';
    stampCount?: number;
    attach?: jest.Mock;
  } = {},
) {
  const defaultShipment = {
    id: SHIP,
    status: ShipmentStatus.CREATED,
    packCompletedAt: null,
    manifestId: null,
    manifest: null,
    orderShipments: [{ orderId: ORDER }],
  };
  const shipmentFindFirst = jest.fn(async () =>
    opts.shipment === undefined ? defaultShipment : opts.shipment,
  );
  const shipmentUpdateMany = jest.fn<Promise<{ count: number }>, [AnyArgs]>(
    async () => ({ count: opts.stampCount ?? 1 }),
  );
  const client = {
    shipment: { findFirst: shipmentFindFirst, updateMany: shipmentUpdateMany },
  };

  const getById = jest.fn(async () =>
    opts.orderStatus === 'missing'
      ? null
      : { orderId: ORDER, status: opts.orderStatus ?? OrderStatus.PICKED },
  );
  const orders = { getById };
  const transitionStatus = jest.fn(async () => ({
    orderId: ORDER,
    status: OrderStatus.PACKED,
  }));
  const orderWrite = { transitionStatus };
  const attachShipment =
    opts.attach ??
    jest.fn(async () => ({
      shipmentId: SHIP,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      manifestCreated: true,
      alreadyAttached: false,
    }));
  const manifests = { attachShipment };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a');
  const audit = { log: auditLog };

  const svc = new PackService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
    orders as unknown as OrderReadService,
    orderWrite as unknown as OrderWriteService,
    manifests as unknown as ManifestService,
  );
  return {
    svc,
    shipmentFindFirst,
    shipmentUpdateMany,
    getById,
    transitionStatus,
    attachShipment,
    auditLog,
  };
}

describe('PackService.complete', () => {
  it('happy path: stamp → PICKED→PACKED → attach to NEW DRAFT manifest', async () => {
    const { svc, shipmentUpdateMany, transitionStatus, attachShipment } =
      makeService();
    const r = await svc.complete(SHIP, STAFF);

    // Stamp BEFORE transition (operational write first).
    const stampOrd = shipmentUpdateMany.mock.invocationCallOrder[0] ?? 0;
    const transOrd = transitionStatus.mock.invocationCallOrder[0] ?? 0;
    expect(stampOrd).toBeLessThan(transOrd);

    expect(shipmentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: SHIP,
          status: ShipmentStatus.CREATED,
          packCompletedAt: null,
        }),
        data: expect.objectContaining({ packedByStaffId: STAFF }),
      }),
    );
    expect(transitionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        to: OrderStatus.PACKED,
        expectedFrom: OrderStatus.PICKED,
      }),
    );
    expect(attachShipment).toHaveBeenCalledWith(
      SHIP,
      expect.anything(),
      undefined,
    );
    expect(r).toMatchObject({
      status: OrderStatus.PACKED,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      alreadyComplete: false,
    });
  });

  it('idempotent: already PACKED + stamped → no-op (no transition, no attach)', async () => {
    const packedAt = new Date('2026-05-19T12:00:00Z');
    const { svc, transitionStatus, attachShipment, shipmentUpdateMany } =
      makeService({
        orderStatus: OrderStatus.PACKED,
        shipment: {
          id: SHIP,
          status: ShipmentStatus.CREATED,
          packCompletedAt: packedAt,
          manifestId: 'man-1',
          manifest: { manifestNumber: 'MF-2026-05-000001' },
          orderShipments: [{ orderId: ORDER }],
        },
      });
    const r = await svc.complete(SHIP, STAFF);
    expect(r).toEqual({
      shipmentId: SHIP,
      orderId: ORDER,
      status: OrderStatus.PACKED,
      packCompletedAt: packedAt,
      manifestId: 'man-1',
      manifestNumber: 'MF-2026-05-000001',
      alreadyComplete: true,
    });
    expect(shipmentUpdateMany).not.toHaveBeenCalled();
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(attachShipment).not.toHaveBeenCalled();
  });

  it('rejects ORDER_NOT_PACKABLE when order is not PICKED', async () => {
    const { svc } = makeService({ orderStatus: OrderStatus.CONFIRMED });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'ORDER_NOT_PACKABLE' },
    });
  });

  it('rejects SHIPMENT_NOT_PACKABLE when shipment past CREATED', async () => {
    const { svc } = makeService({
      shipment: {
        id: SHIP,
        status: ShipmentStatus.HANDED_TO_COURIER,
        packCompletedAt: null,
        manifestId: null,
        manifest: null,
        orderShipments: [{ orderId: ORDER }],
      },
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'SHIPMENT_NOT_PACKABLE' },
    });
  });

  it('race: PACK_NOT_AVAILABLE when updateMany count=0', async () => {
    const { svc, transitionStatus, attachShipment } = makeService({
      stampCount: 0,
    });
    await expect(svc.complete(SHIP, STAFF)).rejects.toMatchObject({
      response: { code: 'PACK_NOT_AVAILABLE' },
    });
    expect(transitionStatus).not.toHaveBeenCalled();
    expect(attachShipment).not.toHaveBeenCalled();
  });

  it('best-effort: attach failure is swallowed, return manifestId null', async () => {
    const attach = jest.fn(async () => {
      throw new Error('manifest temp down');
    });
    const { svc } = makeService({ attach });
    const r = await svc.complete(SHIP, STAFF);
    expect(r).toMatchObject({
      status: OrderStatus.PACKED,
      manifestId: null,
      manifestNumber: null,
      alreadyComplete: false,
    });
  });

  it('404 when shipment is missing', async () => {
    const { svc } = makeService({ shipment: null });
    await expect(svc.complete(SHIP, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 when order is missing', async () => {
    const { svc } = makeService({ orderStatus: 'missing' });
    await expect(svc.complete(SHIP, STAFF)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
