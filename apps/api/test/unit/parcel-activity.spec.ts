import 'reflect-metadata';
import { ActorType, OrderStatus } from '@skydrop/db';
import { REQUIRE_PERMISSIONS_KEY } from '../../src/common/auth/require-permissions.decorator';
import { AdminOrderController } from '../../src/modules/order/controllers/admin-order.controller';
import { AdminParcelActivityController } from '../../src/modules/warehouse-activity/controllers/admin-parcel-activity.controller';
import { AdminParcelLastTouchController } from '../../src/modules/warehouse-activity/controllers/admin-parcel-last-touch.controller';
import { AdminWarehouseHoldsController } from '../../src/modules/warehouse-activity/controllers/admin-warehouse-holds.controller';
import { AdminWarehouseController } from '../../src/modules/inventory-warehouse/admin-warehouse.controller';
import { ParcelActivityService } from '../../src/modules/warehouse-activity/services/parcel-activity.service';
import {
  WarehouseHoldsService,
  STUCK_AFTER_MINUTES,
} from '../../src/modules/warehouse-activity/services/warehouse-holds.service';
import {
  actorForEvent,
  actorForStaffId,
  staffDisplayName,
} from '../../src/modules/warehouse-activity/services/warehouse-actor';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * The parcel activity trail and the live holds board.
 *
 * Four things this pins, each because getting it wrong is invisible:
 * the trail reads in the order the work happened; a step with no person
 * behind it says so instead of inventing one; nothing client-shaped
 * travels on a cross-client staff payload; and both routes sit behind
 * the permission their surrounding surface already demands.
 */

const STAFF_A = '0192c000-0000-7000-8000-00000000000a';
const STAFF_GONE = '0192c000-0000-7000-8000-00000000000b';
const ORDER = '0192c000-0000-7000-8000-000000000001';

const iso = (s: string): Date => new Date(s);

function makeTrail(opts: {
  shipments?: unknown[];
  events?: unknown[];
  shortRows?: unknown[];
  staff?: unknown[];
  order?: unknown;
}): { svc: ParcelActivityService; staffFind: jest.Mock } {
  const staffFind = jest.fn(async () => opts.staff ?? []);
  const prisma = {
    client: {
      order: {
        // `'order' in opts` rather than `??`: a test passing null is
        // saying "the order is gone", which `??` would overwrite.
        findUnique: jest.fn(async () =>
          'order' in opts ? opts.order : { id: ORDER, orderNumber: 'SD-1' },
        ),
      },
      shipment: { findMany: jest.fn(async () => opts.shipments ?? []) },
      orderEvent: { findMany: jest.fn(async () => opts.events ?? []) },
      auditLog: { findMany: jest.fn(async () => opts.shortRows ?? []) },
      staffUser: { findMany: staffFind },
    },
  } as unknown as PrismaService;
  return { svc: new ParcelActivityService(prisma), staffFind };
}

/** One shipment row with everything nulled, overridden per test. */
function shipmentRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ship-1',
    shipmentNumber: 'SH-1',
    awbNumber: 'AWB1',
    supersededAt: null,
    labelPrintedAt: null,
    labelPrintedByStaffId: null,
    labelPrintCount: 0,
    pickStartedAt: null,
    pickStartedByStaffId: null,
    pickCompletedAt: null,
    packCompletedAt: null,
    packedByStaffId: null,
    courierChosenAt: null,
    courierChosenByStaffId: null,
    handoverScannedAt: null,
    handoverScannedByStaffId: null,
    pickedUpByCourierAt: null,
    rtoReceivedAt: null,
    pickBatch: null,
    manifest: null,
    awbLabels: [],
    packBoxes: [],
    items: [],
    ...over,
  };
}

describe('staff display name', () => {
  it('humanises the login instead of printing an email or a uuid', () => {
    expect(staffDisplayName({ emailDisplay: 'Rakib.Hasan@skydrop.global', email: '' }).name).toBe(
      'Rakib Hasan',
    );
    expect(staffDisplayName({ emailDisplay: '', email: 'qa-bot@skydrop.online' }).name).toBe(
      'Qa Bot',
    );
    // Nothing to show is null, never an empty string the screen would
    // render as a blank row.
    expect(staffDisplayName({ emailDisplay: '@x.com', email: '@x.com' }).name).toBeNull();
  });
});

describe('an actor degrades honestly', () => {
  const names = new Map([
    [STAFF_A, { id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }],
    [
      STAFF_GONE,
      {
        id: STAFF_GONE,
        emailDisplay: 'old.packer@skydrop.global',
        email: '',
        deletedAt: iso('2026-01-01T00:00:00Z'),
      },
    ],
  ]);

  it('names a live staff member', () => {
    expect(actorForStaffId(STAFF_A, names)).toEqual({ kind: 'STAFF', name: 'Karim' });
  });

  it('keeps the name of a staff member who has left, and says they have', () => {
    // The act was still theirs. Blanking it would rewrite history.
    expect(actorForStaffId(STAFF_GONE, names)).toEqual({
      kind: 'STAFF_REMOVED',
      name: 'Old Packer',
    });
  });

  it('reads a null actor id as the system, and an unresolvable one as unknown', () => {
    expect(actorForStaffId(null, names)).toEqual({ kind: 'SYSTEM', name: null });
    expect(actorForStaffId('0192c000-0000-7000-8000-0000000000ff', names)).toEqual({
      kind: 'UNKNOWN',
      name: null,
    });
  });

  it('never leaks a client name through an event actor', () => {
    expect(actorForEvent(ActorType.SELLER, 'seller-user-1', names)).toEqual({
      kind: 'SELLER',
      name: null,
    });
    expect(actorForEvent(ActorType.STAFF_AS_SELLER, 'seller-user-1', names)).toEqual({
      kind: 'STAFF_AS_CLIENT',
      name: null,
    });
    expect(actorForEvent(ActorType.SYSTEM, null, names)).toEqual({ kind: 'SYSTEM', name: null });
  });
});

describe('the trail reads in the order the work happened', () => {
  it('sorts by time, and breaks a shared timestamp by lifecycle rank', async () => {
    const at = iso('2026-11-10T04:00:00Z');
    const { svc } = makeTrail({
      shipments: [
        shipmentRow({
          // Written in one transaction: identical timestamps, and the
          // ladder must still read forwards.
          packCompletedAt: at,
          packedByStaffId: STAFF_A,
          labelPrintedAt: iso('2026-11-10T03:00:00Z'),
          labelPrintedByStaffId: STAFF_A,
          labelPrintCount: 1,
          packBoxes: [
            {
              id: 'box-1',
              packerStaffId: STAFF_A,
              status: 'OPEN',
              openedAt: iso('2026-11-10T03:30:00Z'),
              closedAt: at,
              cancelledAt: null,
            },
          ],
          handoverScannedAt: iso('2026-11-10T05:00:00Z'),
          handoverScannedByStaffId: STAFF_A,
        }),
      ],
      staff: [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }],
    });

    const trail = await svc.forOrder(ORDER);
    expect(trail.events.map((e) => e.kind)).toEqual([
      'LABEL_PRINTED',
      'PACK_BOX_OPENED',
      'PACK_BOX_CLOSED',
      'PACKED',
      'HANDOVER_SCANNED',
    ]);
    expect(trail.events.every((e) => e.actor.name === 'Karim')).toBe(true);
    expect(trail.parcels[0]?.lastTouch?.kind).toBe('HANDOVER_SCANNED');
  });

  it('answers "who picked it" from the PICKED transition, since no column holds it', async () => {
    const { svc } = makeTrail({
      shipments: [shipmentRow({ pickCompletedAt: iso('2026-11-10T04:00:00Z') })],
      events: [{ toStatus: OrderStatus.PICKED, actorType: ActorType.STAFF, actorId: STAFF_A }],
      staff: [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }],
    });
    const trail = await svc.forOrder(ORDER);
    expect(trail.events[0]).toMatchObject({
      kind: 'PICKED',
      actor: { kind: 'STAFF', name: 'Karim' },
    });
  });

  it('says NOT RECORDED rather than guessing when the transition row is gone', async () => {
    const { svc } = makeTrail({
      shipments: [
        shipmentRow({
          pickCompletedAt: iso('2026-11-10T04:00:00Z'),
          // Somebody claimed the pick; that is NOT evidence they walked
          // it, so the step must not borrow their name.
          pickStartedAt: iso('2026-11-10T03:00:00Z'),
          pickStartedByStaffId: STAFF_A,
        }),
      ],
      events: [],
      staff: [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }],
    });
    const trail = await svc.forOrder(ORDER);
    const picked = trail.events.find((e) => e.kind === 'PICKED');
    expect(picked?.actor).toEqual({ kind: 'UNRECORDED', name: null });
  });

  it('calls the courier the courier, and a backfilled stamp the system', async () => {
    const { svc } = makeTrail({
      shipments: [
        shipmentRow({
          pickedUpByCourierAt: iso('2026-11-10T06:00:00Z'),
          // A stamp with no staff id: the sweep or a backfill did it.
          packCompletedAt: iso('2026-11-10T05:00:00Z'),
          packedByStaffId: null,
        }),
      ],
    });
    const trail = await svc.forOrder(ORDER);
    expect(trail.events.map((e) => [e.kind, e.actor.kind])).toEqual([
      ['PACKED', 'SYSTEM'],
      ['COURIER_PICKED_UP', 'COURIER'],
    ]);
  });

  it('carries nothing client-shaped on the payload', async () => {
    const { svc } = makeTrail({
      shipments: [
        shipmentRow({
          handoverScannedAt: iso('2026-11-10T05:00:00Z'),
          handoverScannedByStaffId: STAFF_A,
        }),
      ],
      staff: [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }],
    });
    const trail = await svc.forOrder(ORDER);
    const json = JSON.stringify(trail);
    for (const forbidden of [
      'sellerId',
      'seller',
      'recipient',
      'phone',
      'codAmount',
      'declaredValue',
      'skuCode',
      'email',
      'customer',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('refuses an order that does not exist instead of returning an empty trail', async () => {
    const { svc } = makeTrail({ order: null });
    await expect(svc.forOrder(ORDER)).rejects.toThrow();
  });
});

function makeHolds(rows: {
  pick?: unknown[];
  packClaims?: unknown[];
  boxes?: unknown[];
  batches?: unknown[];
  reprints?: unknown[];
  staff?: unknown[];
}): WarehouseHoldsService {
  const shipmentFind = jest
    .fn()
    .mockImplementationOnce(async () => rows.pick ?? [])
    .mockImplementationOnce(async () => rows.packClaims ?? [])
    .mockImplementationOnce(async () => rows.reprints ?? []);
  const prisma = {
    client: {
      shipment: { findMany: shipmentFind },
      packBox: { findMany: jest.fn(async () => rows.boxes ?? []) },
      pickBatch: { findMany: jest.fn(async () => rows.batches ?? []) },
      staffUser: { findMany: jest.fn(async () => rows.staff ?? []) },
    },
  } as unknown as PrismaService;
  return new WarehouseHoldsService(prisma);
}

const parcelBits = {
  id: 'ship-1',
  shipmentNumber: 'SH-1',
  awbNumber: 'AWB1',
  originWarehouse: { name: 'Delhi' },
  orderShipments: [{ orderId: ORDER, order: { orderNumber: 'SD-1' } }],
};

describe('a live hold', () => {
  const staff = [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }];

  it('is HELD while its window is open, with the holder named', async () => {
    const until = new Date(Date.now() + 10 * 60_000);
    const svc = makeHolds({
      pick: [
        {
          ...parcelBits,
          pickStartedAt: new Date(Date.now() - 60_000),
          pickExpiresAt: until,
          pickStartedByStaffId: STAFF_A,
        },
      ],
      staff,
    });
    const view = await svc.list();
    expect(view.holds).toHaveLength(1);
    expect(view.holds[0]).toMatchObject({
      kind: 'PICK',
      expired: false,
      stuck: false,
      holder: { kind: 'STAFF', name: 'Karim' },
      untilIso: until.toISOString(),
    });
  });

  it('is FREE once the window has passed, whatever the row still says', async () => {
    // The expiry is evaluated in the eligibility predicate, never by a
    // sweeper, so the row sits there populated and must not read "held".
    const svc = makeHolds({
      boxes: [
        {
          id: 'box-1',
          packerStaffId: STAFF_A,
          openedAt: new Date(Date.now() - 6 * 60_000),
          expiresAt: new Date(Date.now() - 60_000),
          orderId: ORDER,
          order: { orderNumber: 'SD-1' },
          shipment: {
            shipmentNumber: 'SH-1',
            awbNumber: 'AWB1',
            originWarehouse: { name: 'Delhi' },
          },
          scans: [{ id: 's1' }],
        },
      ],
      staff,
    });
    const view = await svc.list();
    expect(view.holds[0]).toMatchObject({ kind: 'PACK_BOX', expired: true, stuck: false });
  });

  it('is STUCK when it lapsed long enough ago to mean somebody walked off', async () => {
    const svc = makeHolds({
      boxes: [
        {
          id: 'box-1',
          packerStaffId: STAFF_A,
          openedAt: new Date(Date.now() - 120 * 60_000),
          expiresAt: new Date(Date.now() - (STUCK_AFTER_MINUTES + 5) * 60_000),
          orderId: ORDER,
          order: { orderNumber: 'SD-1' },
          shipment: {
            shipmentNumber: 'SH-1',
            awbNumber: 'AWB1',
            originWarehouse: { name: 'Delhi' },
          },
          scans: [],
        },
      ],
      staff,
    });
    const view = await svc.list();
    expect(view.holds[0]).toMatchObject({ expired: true, stuck: true });
    expect(view.stuckAfterMinutes).toBe(STUCK_AFTER_MINUTES);
  });

  it('gives a printed picking sheet no expiry and reports what is left to walk', async () => {
    const svc = makeHolds({
      batches: [
        {
          id: 'batch-1',
          batchNumber: 'PB-1',
          printedAt: new Date(Date.now() - 60_000),
          printedByStaffId: STAFF_A,
          printCount: 2,
          warehouse: { name: 'Delhi' },
          shipments: [{ pickCompletedAt: new Date() }, { pickCompletedAt: null }],
        },
      ],
      staff,
    });
    const view = await svc.list();
    expect(view.holds[0]).toMatchObject({
      kind: 'PICK_BATCH',
      batchNumber: 'PB-1',
      untilIso: null,
      expired: false,
      stuck: false,
      detail: { unpicked: 1, of: 2, sheets: 2 },
    });
  });

  it('reports a twice-printed label as a reprint, not as a hold on anybody', async () => {
    const svc = makeHolds({
      reprints: [
        {
          ...parcelBits,
          labelPrintCount: 2,
          labelPrintedAt: new Date(Date.now() - 60_000),
          labelPrintedByStaffId: STAFF_A,
          awbLabels: [{ id: 'l1' }],
        },
      ],
      staff,
    });
    const view = await svc.list();
    expect(view.holds).toEqual([]);
    expect(view.reprints[0]).toMatchObject({
      sheets: 2,
      lastPrintedBy: { kind: 'STAFF', name: 'Karim' },
    });
  });

  it('carries no client-shaped field', async () => {
    const svc = makeHolds({
      pick: [
        {
          ...parcelBits,
          pickStartedAt: new Date(),
          pickExpiresAt: new Date(Date.now() + 60_000),
          pickStartedByStaffId: STAFF_A,
        },
      ],
      staff,
    });
    const json = JSON.stringify(await svc.list());
    for (const forbidden of ['sellerId', 'recipient', 'phone', 'codAmount', 'email', 'customer']) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe('the one-line "who last touched this" for a bench row', () => {
  it('picks the most recent stamp and names the person behind it', async () => {
    const { svc } = makeTrail({
      shipments: [
        shipmentRow({
          labelPrintedAt: iso('2026-11-10T03:00:00Z'),
          labelPrintedByStaffId: STAFF_A,
          packCompletedAt: iso('2026-11-10T04:00:00Z'),
          packedByStaffId: STAFF_GONE,
          packBoxes: [
            {
              packerStaffId: STAFF_A,
              openedAt: iso('2026-11-10T03:30:00Z'),
              closedAt: iso('2026-11-10T04:00:00Z'),
              cancelledAt: null,
            },
          ],
        }),
      ],
      staff: [
        { id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null },
        {
          id: STAFF_GONE,
          emailDisplay: 'old.packer@skydrop.global',
          email: '',
          deletedAt: iso('2026-02-01T00:00:00Z'),
        },
      ],
    });
    const [touch] = await svc.lastTouchFor(['ship-1']);
    // PACKED and the closing scan share a timestamp; PACKED is the later
    // step and is the one worth saying.
    expect(touch).toMatchObject({
      kind: 'PACKED',
      actor: { kind: 'STAFF_REMOVED', name: 'Old Packer' },
    });
  });

  it('says nothing at all about a parcel nobody has touched', async () => {
    const { svc } = makeTrail({ shipments: [shipmentRow()] });
    expect(await svc.lastTouchFor(['ship-1'])).toEqual([]);
  });

  it('asks nothing of the database for an empty list', async () => {
    const { svc, staffFind } = makeTrail({});
    expect(await svc.lastTouchFor([])).toEqual([]);
    expect(staffFind).not.toHaveBeenCalled();
  });
});

describe('the permission a reader must hold', () => {
  it('puts the trail behind orders.view — the gate of the page it renders on', () => {
    const trail: unknown = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      AdminParcelActivityController,
    );
    const orders: unknown = Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AdminOrderController);
    expect(trail).toEqual(['orders.view']);
    expect(trail).toEqual(orders);
  });

  it('puts the holds board behind warehouse.view — the warehouse read gate', () => {
    const holds: unknown = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      AdminWarehouseHoldsController,
    );
    const warehouse: unknown = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      AdminWarehouseController,
    );
    expect(holds).toEqual(['warehouse.view']);
    expect(holds).toEqual(warehouse);
  });

  it('declares no handler that widens or bypasses the class gate', () => {
    expect(
      Reflect.getMetadata(
        REQUIRE_PERMISSIONS_KEY,
        AdminParcelActivityController.prototype.forOrder,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, AdminWarehouseHoldsController.prototype.list),
    ).toBeUndefined();
  });

  it('lets any of the three bench keys read the one-line "who last touched this"', () => {
    // OR semantics: a packer holds `warehouse.pack` and need not hold
    // the warehouse read key, and the line is on the screen they work
    // at all day.
    const gate: unknown = Reflect.getMetadata(
      REQUIRE_PERMISSIONS_KEY,
      AdminParcelLastTouchController,
    );
    expect(gate).toEqual(['warehouse.view', 'warehouse.pack', 'courier.dispatch.handoff']);
  });

  it('exposes neither route on a seller, store or associate console', () => {
    // Both controllers are mounted under `admin/` and guarded by the
    // staff JWT; there is deliberately no client-facing twin.
    const sources = [
      AdminParcelActivityController,
      AdminParcelLastTouchController,
      AdminWarehouseHoldsController,
    ];
    for (const ctor of sources) {
      const path: unknown = Reflect.getMetadata('path', ctor);
      expect(String(path).startsWith('admin/')).toBe(true);
    }
  });
});

describe('a short pick shows on the trail', () => {
  const shortRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    entityId: 'ship-1',
    actorType: ActorType.STAFF,
    actorId: STAFF_A,
    createdAt: iso('2026-09-03T10:00:00Z'),
    metadata: { shipmentItemId: 'item-1', expected: 3, found: 2 },
    ...over,
  });
  const staff = [{ id: STAFF_A, emailDisplay: 'karim@skydrop.global', email: '', deletedAt: null }];

  it('reads "2 of 3" with the picker named, ahead of the picked step', async () => {
    const { svc } = makeTrail({
      shipments: [shipmentRow({ pickCompletedAt: iso('2026-09-03T10:00:00Z') })],
      shortRows: [shortRow()],
      staff,
    });
    const trail = await svc.forOrder(ORDER);
    const kinds = trail.events.map((e) => e.kind);
    expect(kinds).toEqual(['PICKED_SHORT', 'PICKED']);
    expect(trail.events[0]).toMatchObject({
      detail: { found: 2, expected: 3 },
      actor: { kind: 'STAFF' },
    });
  });

  it('keeps only the latest statement for a line, so a correction supersedes', async () => {
    const { svc } = makeTrail({
      shipments: [shipmentRow()],
      shortRows: [
        shortRow(),
        shortRow({
          createdAt: iso('2026-09-03T10:05:00Z'),
          metadata: { shipmentItemId: 'item-1', expected: 3, found: 1 },
        }),
      ],
      staff,
    });
    const trail = await svc.forOrder(ORDER);
    expect(trail.events).toHaveLength(1);
    expect(trail.events[0]?.detail).toEqual({ found: 1, expected: 3 });
  });

  it('ignores a malformed row rather than inventing a count', async () => {
    const { svc } = makeTrail({
      shipments: [shipmentRow()],
      shortRows: [shortRow({ metadata: { shipmentItemId: 'item-1' } })],
    });
    expect((await svc.forOrder(ORDER)).events).toHaveLength(0);
  });
});
