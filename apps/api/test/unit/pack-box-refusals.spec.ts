/**
 * What the pack bench SAYS when it refuses a scan (2026-11-10, owner).
 *
 * Every one of these used to come back as `PACK_CODE_UNKNOWN` — "this
 * barcode is not known" — which is false for all but the last of them.
 * Two were seen in production on the same line: a packer scanning ANOTHER
 * PARCEL'S AWB (…394 while the open box was …395), and a packer scanning a
 * product belonging to a different client. The owner: "it should show that
 * you have scanned a wrong parcel. please scan this awb parcel".
 *
 * The thing each test guards is that the refusal NAMES the mistake and the
 * way out of it — the code, and the AWB the packer should be holding. A
 * code alone is not enough: `pack-error-copy.ts` interpolates the AWB into
 * three languages, and it can only do that if the server sends it.
 *
 * Acceptance is NOT what these cover. Nothing here may ever pass: every
 * case is a refusal before and a refusal after, only better named.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PackBoxStatus, StockUnitStatus } from '@skydrop/db';
import {
  PackBoxService,
  clockTime,
  staffName,
} from '../../src/modules/warehouse-pack/services/pack-box.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ScanBlockService } from '../../src/modules/system-issues/services/scan-block.service';
import type { CatalogReadService } from '../../src/modules/catalog-read/services/catalog-read.service';

type AnyArgs = Record<string, unknown>;

const BOX = 'box-1';
const SHIP = 'ship-1';
const STAFF = 'staff-1';
const SELLER = 'seller-1';
/** The parcel on the bench, and the AWB every refusal has to name. */
const OPEN_AWB = '38061110627395';
/** The parcel whose label got picked up by mistake. */
const OTHER_AWB = '38061110627394';
/** 2026-11-10 11:05 IST — the clock time a held box frees itself. */
const EXPIRES = new Date('2026-11-10T05:35:00.000Z');
/** 2026-11-10 10:42 IST — when somebody else finished the parcel. */
const PACKED_AT = new Date('2026-11-10T05:12:00.000Z');

interface Unit {
  readonly status: StockUnitStatus;
  readonly sellerId: string;
  readonly companyName: string;
  readonly shipmentId: string | null;
  readonly awbNumber: string | null;
}

function makeService(
  opts: {
    /** A stock unit whose serial is the scanned code, in any state. */
    unit?: Unit;
    /** Does the scanned code match a live shipment's AWB? */
    otherParcel?: boolean;
    /** A variant of a DIFFERENT client carrying the scanned code. */
    foreign?: { skuCode: string; companyName: string };
    /** Whose bench the box is on, as their email_display. */
    heldBy?: string;
    /** The box's status, for the come-back-from-lunch refusals. */
    boxStatus?: PackBoxStatus;
    /** Has somebody else packed the parcel in the meantime? */
    packedBy?: string | null;
    /** `ops.pack_box_timeout_minutes`, when it is overridden. */
    timeoutMinutes?: number;
    /** The AWB that replaced the scanned one; '' = replaced by nothing we
     *  can name. Undefined = the label was never superseded. */
    superseded?: string;
  } = {},
) {
  const where = (args: unknown): AnyArgs =>
    ((args as { where?: AnyArgs } | undefined)?.where ?? {}) as AnyArgs;

  const stockUnitFindFirst = jest.fn(async (args: unknown) => {
    const w = where(args);
    const u = opts.unit;
    if (u === undefined) return null;
    // The ACCEPTANCE lookup takes PICKED only — unchanged. The diagnosis
    // lookup has no status filter, which is how a serial in any other
    // state stops being reported as an unknown barcode.
    if (w['status'] !== undefined && w['status'] !== StockUnitStatus.PICKED) return null;
    if (w['status'] === StockUnitStatus.PICKED && u.status !== StockUnitStatus.PICKED) return null;
    return {
      id: 'unit-1',
      variantId: 'v-9',
      shipmentItemId: u.shipmentId === null ? null : 'si-1',
      status: u.status,
      sellerId: u.sellerId,
      seller: { companyName: u.companyName },
      shipmentItem:
        u.shipmentId === null
          ? null
          : { shipmentId: u.shipmentId, shipment: { awbNumber: u.awbNumber } },
    };
  });

  const productVariantFindFirst = jest.fn(async (args: unknown) => {
    const w = where(args);
    // This parcel's client (a plain id) never matches in these fixtures —
    // that is the whole premise. `{ not: id }` is the diagnosis lookup.
    if (typeof w['sellerId'] === 'string') return null;
    return opts.foreign === null || opts.foreign === undefined
      ? null
      : { skuCode: opts.foreign.skuCode, seller: { companyName: opts.foreign.companyName } };
  });

  const client: AnyArgs = {
    packBox: {
      findUnique: jest.fn(async () => ({
        status: opts.boxStatus ?? PackBoxStatus.OPEN,
        packerStaffId: opts.heldBy === undefined ? STAFF : 'staff-9',
        shipmentId: SHIP,
        orderId: 'order-1',
        openedWithCode: OPEN_AWB,
        expiresAt: EXPIRES,
      })),
      findFirst: jest.fn(async () => ({
        id: 'box-9',
        packerStaffId: 'staff-9',
        expiresAt: EXPIRES,
        packer: { emailDisplay: opts.heldBy ?? 'packer@skydrop.global' },
        shipment: { awbNumber: OPEN_AWB },
      })),
      update: jest.fn(async () => ({ id: BOX })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    stockUnit: { findFirst: stockUnitFindFirst },
    shipmentItem: {
      findUnique: jest.fn(async () => {
        const u = opts.unit;
        return u === undefined || u.shipmentId === null
          ? null
          : { shipmentId: u.shipmentId, shipment: { awbNumber: u.awbNumber } };
      }),
      findMany: jest.fn(async () => [{ skuCode: 'SKU-A', quantity: 1 }]),
    },
    orderShipment: { findFirst: jest.fn(async () => ({ order: { sellerId: SELLER } })) },
    productVariant: {
      findFirst: productVariantFindFirst,
      findMany: jest.fn(async () => [{ id: 'v-1', skuCode: 'SKU-A' }]),
    },
    shipment: {
      findFirst: jest.fn(async (args: unknown) => {
        const w = where(args);
        // The superseded lookup is the one that asks for a NON-null
        // superseded_at; the open() lookup and the diagnosis one both
        // exclude it.
        if (w['supersededAt'] !== undefined && w['supersededAt'] !== null) {
          return opts.superseded === undefined
            ? null
            : {
                shipmentNumber: 'SH-000007',
                supersededBy: opts.superseded === '' ? [] : [{ awbNumber: opts.superseded }],
              };
        }
        return opts.otherParcel === true ? { shipmentNumber: 'SH-000002' } : null;
      }),
      findUnique: jest.fn(async () => ({
        packCompletedAt: opts.packedBy === undefined ? null : PACKED_AT,
        packedBy: opts.packedBy == null ? null : { emailDisplay: opts.packedBy },
      })),
    },
    systemSetting: {
      findUnique: jest.fn(async () =>
        opts.timeoutMinutes === undefined ? null : { valueInt: opts.timeoutMinutes },
      ),
    },
    packBoxScan: { count: jest.fn(async () => 0), create: jest.fn(async () => ({})) },
    staffUser: {
      findUnique: jest.fn(async () => ({ emailDisplay: opts.heldBy ?? 'packer@skydrop.global' })),
    },
  };

  const svc = new PackBoxService(
    { client } as unknown as PrismaService,
    { log: jest.fn(async () => 'a') } as unknown as AuditLogService,
    { assertNotBlocked: jest.fn(async () => undefined) } as unknown as ScanBlockService,
    { thumbnailUrlsByVariant: jest.fn(async () => new Map()) } as unknown as CatalogReadService,
  );
  return { svc, stockUnitFindFirst, productVariantFindFirst, client };
}

/** The refusal's body, or a failure saying the scan was ACCEPTED. */
async function refusalOf(
  p: Promise<unknown>,
): Promise<{ code: string; message: string; details?: Record<string, string> }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ConflictException || err instanceof NotFoundException) {
      return err.getResponse() as {
        code: string;
        message: string;
        details?: Record<string, string>;
      };
    }
    throw err;
  }
  throw new Error('the scan was ACCEPTED — a refusal must never become an acceptance');
}

describe('PackBoxService.scan — the refusal names the mistake', () => {
  it('another parcel’s AWB: its own code, and the message names the AWB to scan', async () => {
    const { svc } = makeService({ otherParcel: true });
    const refusal = await refusalOf(svc.scan(BOX, OTHER_AWB, STAFF));

    expect(refusal.code).toBe('PACK_WRONG_PARCEL_LABEL');
    // The whole ask: tell them WHICH parcel to scan.
    expect(refusal.message).toContain(OPEN_AWB);
    expect(refusal.message).toContain(OTHER_AWB);
    expect(refusal.details?.['awb']).toBe(OPEN_AWB);
  });

  it('a real product of ANOTHER CLIENT: its own code, and NO client named', async () => {
    const { svc } = makeService({
      foreign: { skuCode: 'MST-SUNG-01', companyName: 'Menev Store' },
    });
    const refusal = await refusalOf(svc.scan(BOX, 'BAR-OTHER', STAFF));

    expect(refusal.code).toBe('PACK_PRODUCT_OTHER_CLIENT');
    // The code the packer scanned — it is already in their hand.
    expect(refusal.message).toContain('BAR-OTHER');
    expect(refusal.details?.['item']).toBe('BAR-OTHER');
    // A colleague may be named on this bench; another CLIENT may not.
    // Neither their company name nor their SKU appears anywhere.
    expect(refusal.message).not.toContain('Menev Store');
    expect(refusal.message).not.toContain('MST-SUNG-01');
    expect(JSON.stringify(refusal.details ?? {})).not.toContain('Menev');
  });

  it('a serial for another parcel that is not PICKED reaches PACK_UNIT_WRONG_PARCEL, not “unknown”', async () => {
    const { svc } = makeService({
      unit: {
        status: StockUnitStatus.IN_STOCK,
        sellerId: SELLER,
        companyName: 'This Client',
        shipmentId: 'ship-2',
        awbNumber: OTHER_AWB,
      },
    });
    const refusal = await refusalOf(svc.scan(BOX, 'SN-0001', STAFF));

    expect(refusal.code).toBe('PACK_UNIT_WRONG_PARCEL');
    expect(refusal.message).toContain(OTHER_AWB);
    expect(refusal.message).toContain(OPEN_AWB);
  });

  it('a PICKED serial for another parcel names both parcels', async () => {
    const { svc } = makeService({
      unit: {
        status: StockUnitStatus.PICKED,
        sellerId: SELLER,
        companyName: 'This Client',
        shipmentId: 'ship-2',
        awbNumber: OTHER_AWB,
      },
    });
    const refusal = await refusalOf(svc.scan(BOX, 'SN-0001', STAFF));

    expect(refusal.code).toBe('PACK_UNIT_WRONG_PARCEL');
    expect(refusal.details?.['awb']).toBe(OPEN_AWB);
    expect(refusal.details?.['otherAwb']).toBe(OTHER_AWB);
  });

  it('a serial on THIS parcel in a state that cannot be packed says so', async () => {
    const { svc } = makeService({
      unit: {
        status: StockUnitStatus.IN_STOCK,
        sellerId: SELLER,
        companyName: 'This Client',
        shipmentId: SHIP,
        awbNumber: OPEN_AWB,
      },
    });
    const refusal = await refusalOf(svc.scan(BOX, 'SN-0001', STAFF));

    expect(refusal.code).toBe('PACK_UNIT_NOT_PICKED');
    expect(refusal.details?.['state']).toBe('in stock');
  });

  it('a serial belonging to another client is somebody else’s goods, not an unknown code', async () => {
    const { svc } = makeService({
      unit: {
        status: StockUnitStatus.IN_STOCK,
        sellerId: 'seller-9',
        companyName: 'Menev Store',
        shipmentId: 'ship-2',
        awbNumber: OTHER_AWB,
      },
    });
    const refusal = await refusalOf(svc.scan(BOX, 'SN-0001', STAFF));

    expect(refusal.code).toBe('PACK_PRODUCT_OTHER_CLIENT');
    expect(refusal.message).toContain('SN-0001');
    expect(refusal.message).not.toContain('Menev Store');
  });

  it('this box’s OWN label in the product field is named, not called unknown', async () => {
    const { svc } = makeService();
    const refusal = await refusalOf(svc.scan(BOX, OPEN_AWB, STAFF));

    expect(refusal.code).toBe('PACK_OWN_LABEL_NOT_A_PRODUCT');
    expect(refusal.details?.['awb']).toBe(OPEN_AWB);
  });

  it('a code that matches nothing anywhere keeps PACK_CODE_UNKNOWN — now true', async () => {
    const { svc } = makeService();
    const refusal = await refusalOf(svc.scan(BOX, 'dfc', STAFF));

    expect(refusal.code).toBe('PACK_CODE_UNKNOWN');
    expect(refusal.message).toContain('dfc');
  });

  it('the diagnosis costs the HAPPY path nothing: no extra lookup when the SKU resolves', async () => {
    const { svc, client } = makeService();
    const variant = client['productVariant'] as { findFirst: jest.Mock };
    variant.findFirst.mockImplementation(async (args: unknown) => {
      const w = ((args as { where?: AnyArgs }).where ?? {}) as AnyArgs;
      return typeof w['sellerId'] === 'string' ? { id: 'v-1', skuCode: 'SKU-A' } : null;
    });

    await svc.scan(BOX, 'SKU-A', STAFF);

    // One lookup, the seller-scoped one. The diagnosis never ran.
    expect(variant.findFirst).toHaveBeenCalledTimes(1);
    const shipment = client['shipment'] as { findFirst: jest.Mock };
    expect(shipment.findFirst).not.toHaveBeenCalled();
  });
});

describe('PackBoxService — a refusal two colleagues can settle between them', () => {
  it('a box on somebody else’s bench names WHO has it and WHEN it frees itself', async () => {
    const { svc } = makeService({ heldBy: 'rahim.ali@skydrop.global' });
    const refusal = await refusalOf(svc.scan(BOX, 'SKU-A', STAFF));

    expect(refusal.code).toBe('PACK_BOX_HELD_BY_OTHER');
    // A NAME, not a uuid and not an email.
    expect(refusal.details?.['who']).toBe('Rahim Ali');
    expect(refusal.message).toContain('Rahim Ali');
    expect(refusal.message).not.toContain('@');
    expect(refusal.message).not.toContain('staff-9');
    // A CLOCK TIME, in the warehouse's own zone, Western numerals.
    expect(refusal.details?.['when']).toBe('11:05');
    expect(refusal.message).toContain('11:05');
    // And the way out, naming who does it.
    expect(refusal.message).toContain('close or cancel');
  });

  it('an unnameable holder degrades to the scenario — never “held by undefined”', async () => {
    const { svc } = makeService({ heldBy: '' });
    const refusal = await refusalOf(svc.scan(BOX, 'SKU-A', STAFF));

    expect(refusal.code).toBe('PACK_BOX_HELD_BY_OTHER');
    expect(refusal.details?.['who']).toBeUndefined();
    expect(refusal.message).toContain('Another packer');
    expect(refusal.message.toLowerCase()).not.toContain('undefined');
    expect(refusal.message.toLowerCase()).not.toContain('null');
    // The time is still useful on its own.
    expect(refusal.details?.['when']).toBe('11:05');
  });
});

/**
 * The box frees itself after ten minutes of NOBODY SCANNING (owner,
 * 2026-11-10). As a TOTAL budget ten minutes would expire a twenty-line
 * order under the packer; measured from the last scan it only ever
 * catches a bench nobody is at.
 */
describe('PackBoxService — the deadline slides with the work', () => {
  function boxUpdate(client: AnyArgs): jest.Mock {
    return (client['packBox'] as { update: jest.Mock }).update;
  }

  it('every accepted scan pushes the deadline forward, in the SAME write as the scan', async () => {
    const { svc, client } = makeService();
    const variant = client['productVariant'] as { findFirst: jest.Mock };
    variant.findFirst.mockImplementation(async (args: unknown) => {
      const w = ((args as { where?: AnyArgs }).where ?? {}) as AnyArgs;
      return typeof w['sellerId'] === 'string' ? { id: 'v-1', skuCode: 'SKU-A' } : null;
    });

    const before = Date.now();
    const result = await svc.scan(BOX, 'SKU-A', STAFF);

    // ONE write carries both: the scan row is nested in the box update,
    // so there is no read-then-write of expires_at anywhere.
    expect(boxUpdate(client)).toHaveBeenCalledTimes(1);
    const args = boxUpdate(client).mock.calls[0]?.[0] as {
      data: { expiresAt: Date; scans: { create: { scannedCode: string } } };
    };
    expect(args.data.scans.create.scannedCode).toBe('SKU-A');
    // Ten minutes from NOW, not from when the box opened.
    const pushed = args.data.expiresAt.getTime();
    expect(pushed).toBeGreaterThanOrEqual(before + 9 * 60_000);
    expect(pushed).toBeLessThanOrEqual(Date.now() + 11 * 60_000);
    expect(pushed).toBeGreaterThan(EXPIRES.getTime());
    // And the bench is told the live value, so the clock it draws is true.
    expect(result.expiresAt.getTime()).toBe(pushed);
  });

  it('honours ops.pack_box_timeout_minutes over the ten-minute default', async () => {
    const { svc, client } = makeService({ timeoutMinutes: 45 });
    const variant = client['productVariant'] as { findFirst: jest.Mock };
    variant.findFirst.mockImplementation(async (args: unknown) => {
      const w = ((args as { where?: AnyArgs }).where ?? {}) as AnyArgs;
      return typeof w['sellerId'] === 'string' ? { id: 'v-1', skuCode: 'SKU-A' } : null;
    });

    const result = await svc.scan(BOX, 'SKU-A', STAFF);
    const minutes = (result.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(44);
    expect(minutes).toBeLessThanOrEqual(45);
  });

  it('the packer who came back from lunch is told the parcel went back to the queue', async () => {
    const { svc } = makeService({ boxStatus: PackBoxStatus.EXPIRED });
    const refusal = await refusalOf(svc.scan(BOX, 'SKU-A', STAFF));

    expect(refusal.code).toBe('PACK_BOX_EXPIRED');
    expect(refusal.message).toContain('went back to the queue');
    expect(refusal.message).toContain('nothing was lost');
    expect(refusal.details?.['awb']).toBe(OPEN_AWB);
  });

  it('…and if somebody else has since packed it, WHO and WHEN instead', async () => {
    const { svc } = makeService({
      boxStatus: PackBoxStatus.EXPIRED,
      packedBy: 'rahim.ali@skydrop.global',
    });
    const refusal = await refusalOf(svc.scan(BOX, 'SKU-A', STAFF));

    expect(refusal.code).toBe('PACK_PARCEL_PACKED_BY_OTHER');
    expect(refusal.details?.['who']).toBe('Rahim Ali');
    expect(refusal.details?.['when']).toBe('10:42');
    expect(refusal.message).toContain('Rahim Ali');
    expect(refusal.message).not.toContain('@');
  });

  it('a CLOSED or CANCELLED box is still the ordinary refusal, not the expiry story', async () => {
    for (const status of [PackBoxStatus.CLOSED, PackBoxStatus.CANCELLED]) {
      const { svc } = makeService({ boxStatus: status });
      const refusal = await refusalOf(svc.scan(BOX, 'SKU-A', STAFF));
      expect(refusal.code).toBe('PACK_BOX_NOT_OPEN');
    }
  });

  it('the sweep only ever claims a box whose deadline has passed', async () => {
    const { svc, client } = makeService();
    const packBox = client['packBox'] as { findMany?: jest.Mock; updateMany: jest.Mock };
    packBox.findMany = jest.fn(async () => []);

    await svc.expireOverdue();

    const where = (packBox.findMany.mock.calls[0]?.[0] as { where: AnyArgs }).where;
    expect(where['status']).toBe(PackBoxStatus.OPEN);
    // A box being scanned right now has had its deadline pushed into the
    // future by that scan, so this filter cannot see it.
    expect(where['expiresAt']).toHaveProperty('lt');
  });
});

/**
 * A SUPERSEDED label (2026-11-10, handed over by the concurrency work).
 * The parcel now travels under a new AWB, so the open() lookup excludes
 * the old row on purpose — but `PACK_AWB_NOT_FOUND` reads to an amateur
 * as a broken scanner, and the whole pile of old stickers then gets
 * re-scanned one at a time.
 */
describe('PackBoxService.open — a replaced label says so', () => {
  it('names the new label and tells them to bin the old sticker', async () => {
    const { svc } = makeService({ superseded: '38061110627999' });
    const refusal = await refusalOf(svc.open(OTHER_AWB, STAFF));

    expect(refusal.code).toBe('PACK_LABEL_SUPERSEDED');
    expect(refusal.message).toContain('was replaced');
    expect(refusal.message).toContain('38061110627999');
    expect(refusal.details?.['awb']).toBe('38061110627999');
    expect(refusal.details?.['otherAwb']).toBe(OTHER_AWB);
  });

  it('still says the label was replaced when the new AWB is not known yet', async () => {
    const { svc } = makeService({ superseded: '' });
    const refusal = await refusalOf(svc.open(OTHER_AWB, STAFF));

    expect(refusal.code).toBe('PACK_LABEL_SUPERSEDED');
    expect(refusal.details?.['awb']).toBeUndefined();
    expect(refusal.message.toLowerCase()).not.toContain('undefined');
  });

  it('a label that was never ours is still PACK_AWB_NOT_FOUND', async () => {
    const { svc } = makeService();
    const refusal = await refusalOf(svc.open('ZZZ-999', STAFF));

    expect(refusal.code).toBe('PACK_AWB_NOT_FOUND');
  });
});

describe('staffName / clockTime', () => {
  it('turns an address into a name and never back into an address', () => {
    expect(staffName('rahim.ali@skydrop.global')).toBe('Rahim Ali');
    expect(staffName('Packer_One@skydrop.global')).toBe('Packer One');
    expect(staffName('qa-bot@skydrop.online')).toBe('Qa Bot');
    for (const input of [null, undefined, '', '@skydrop.global', '  ']) {
      expect(staffName(input)).toBeNull();
    }
  });

  it('shows a wall-clock time in the warehouse’s zone, 24-hour, Western numerals', () => {
    expect(clockTime(new Date('2026-11-10T05:35:00.000Z'))).toBe('11:05');
    expect(clockTime(new Date('2026-11-10T18:45:00.000Z'))).toBe('00:15');
    expect(clockTime(null)).toBeNull();
    expect(clockTime(new Date('not a date'))).toBeNull();
  });
});

describe('PackBoxService.close — the label mismatch names the label that closes it', () => {
  it('names the AWB the box was opened with', async () => {
    const { svc } = makeService();
    const refusal = await refusalOf(svc.close(BOX, OTHER_AWB, STAFF));

    expect(refusal.code).toBe('PACK_LABEL_MISMATCH');
    expect(refusal.message).toContain(OPEN_AWB);
    expect(refusal.details?.['awb']).toBe(OPEN_AWB);
  });
});
