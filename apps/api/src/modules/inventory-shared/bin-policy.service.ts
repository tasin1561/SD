import { BadRequestException, Injectable } from '@nestjs/common';
import { BinType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  DEFAULT_ZONE_CODE,
  FLOOR_BIN_CODE,
  TRANSIT_BIN_CODE,
} from '../inventory-warehouse/bin-code';

/**
 * The ONE place `warehouses.bin_tracking_enabled` is read.
 *
 * Every surface that needs a bin — receiving putaway, RTO restock,
 * adjustments, transfers — asks this service for one and does not know
 * whether tracking is on. Five call sites each testing the flag
 * themselves is precisely how they come to disagree; the same argument
 * that put courier context behind one service and the outcome tables
 * behind one mapping service.
 *
 * The off state is NOT a null. `stock_levels.bin_id` is NOT NULL and the
 * unique key includes it, so stock must always be somewhere — "off"
 * means everything resolves to the warehouse's FLOOR bin, which is a
 * real row.
 */

/**
 * Bins a picker can never reach.
 *
 * Kept here rather than in the pick allocator because availability
 * (INV-3) and pick allocation MUST agree on this list. When they
 * disagreed — availability counting RTO_HOLD stock the allocator
 * refused to touch — the result was orders that confirmed happily and
 * then shortfalled on the warehouse floor, which is the expensive place
 * to discover a problem.
 */
export const NON_PICKABLE_BIN_TYPES: readonly BinType[] = [
  BinType.RTO_HOLD,
  BinType.DAMAGED,
  BinType.QUARANTINE,
  // Goods in the air between two of our warehouses. On hand, really
  // ours, and not sellable from anywhere until they land and are
  // counted — see docs/consignment-two-leg.md.
  BinType.TRANSIT,
];

/**
 * DERIVED, deliberately: the complement of the list above rather than a
 * second hand-written list. Two hand-maintained lists that must stay
 * complementary is the same drift hazard the comment above describes,
 * one level up — adding a bin type to the enum and remembering only one
 * of them would silently make it both pickable and not.
 */
export const PICKABLE_BIN_TYPES: readonly BinType[] = Object.values(BinType).filter(
  (t) => !NON_PICKABLE_BIN_TYPES.includes(t),
);

/**
 * Would moving goods from `sourceType` to `destType` make unsellable
 * stock sellable?
 *
 * BIN-2 says a bin a picker cannot reach is about NOT SELLING stock, not
 * about where it happens to be standing. So the direction that matters is
 * exactly one: out of a bin nothing can be picked from, into one it can.
 * A move the other way (a shelf's goods discovered broken and carried to
 * DAMAGED) is conservative, and a move within the non-pickable set
 * (re-organising the quarantine corner) changes nothing about what is
 * sellable. Only this direction silently reverses a decision somebody
 * made — a return nobody triaged, a unit written off as damaged, or
 * goods still in the air between Dhaka and India (CNS-1) — and the
 * goods become pickable with no record that the decision was revisited.
 *
 * DERIVED from `NON_PICKABLE_BIN_TYPES` on BOTH sides, so adding a bin
 * type to that list tightens the source test and the destination test
 * together. `BinCollapseService` restated the list as
 * `['RTO_HOLD', 'DAMAGED', 'QUARANTINE']` and therefore missed TRANSIT
 * for as long as TRANSIT existed; a second hand-written copy here would
 * be the same bug in a new place.
 *
 * The sanctioned way OUT of a hold bin is the path that already carries
 * the judgement: `RtoPutawayService`, which offers only the units a
 * finalize restocked, subtracts the ones nobody has decided about, and
 * refuses a non-pickable destination of its own. A write-off leaves by
 * an adjustment with a reason code (INV-7). Neither is a re-shelving.
 */
export function moveWouldMakeStockSellable(sourceType: BinType, destType: BinType): boolean {
  return NON_PICKABLE_BIN_TYPES.includes(sourceType) && !NON_PICKABLE_BIN_TYPES.includes(destType);
}

/** The one refusal, so both movers say the same thing. */
export const MOVE_MAKES_STOCK_SELLABLE_CODE = 'TRANSFER_WOULD_MAKE_STOCK_SELLABLE';

export function moveMakesStockSellableMessage(
  source: { readonly code: string; readonly type: BinType },
  dest: { readonly code: string; readonly type: BinType },
): string {
  return (
    `${source.code} is a ${source.type} bin — nothing in it can be picked. ` +
    `Moving it to ${dest.code} would put those goods back into sellable stock ` +
    'without anybody deciding they should be. Use the return put-away for a ' +
    'return, or an adjustment with a reason for a write-off.'
  );
}

@Injectable()
export class BinPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async isTrackingEnabled(warehouseId: string, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = tx ?? this.prisma.client;
    const row = await db.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null },
      select: { binTrackingEnabled: true },
    });
    // A missing warehouse is somebody else's error to raise; defaulting
    // to "not tracking" here just means we do not demand a bin.
    return row?.binTrackingEnabled ?? false;
  }

  /**
   * The FLOOR bin for a warehouse, created on warehouse creation.
   *
   * Self-heals if it is absent — a warehouse that predates the
   * auto-provisioning, or one whose FLOOR was deleted, would otherwise
   * be unable to receive anything at all.
   */
  async floorBinId(warehouseId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma.client;
    const existing = await db.warehouseBin.findFirst({
      where: { warehouseId, code: FLOOR_BIN_CODE, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;

    // A warehouse that predates auto-provisioning may have no zone
    // either — the one in production has neither. Refusing here would
    // mean it could not receive stock until someone found the right
    // screen, which is the dead end this whole change exists to remove.
    // Creating MAIN is the same thing warehouse creation now does.
    const zone =
      (await db.warehouseZone.findFirst({
        where: { warehouseId, deletedAt: null },
        orderBy: { pickOrder: 'asc' },
        select: { id: true },
      })) ??
      (await db.warehouseZone.create({
        data: { warehouseId, code: DEFAULT_ZONE_CODE, name: 'Main', pickOrder: 100 },
        select: { id: true },
      }));

    const created = await db.warehouseBin.create({
      data: {
        warehouseId,
        zoneId: zone.id,
        code: FLOOR_BIN_CODE,
        type: BinType.STORAGE,
        aisle: null,
        rack: null,
        shelf: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * The TRANSIT bin for a warehouse — find-or-create, like FLOOR.
   *
   * Provisioned on demand by the dispatch that needs it rather than at
   * warehouse creation, because most warehouses never receive an
   * inter-warehouse shipment and a bin nobody uses is one more row on
   * every bins screen. It is non-pickable (BIN-2), so stock parked here
   * is on hand, really ours, and sellable from nowhere.
   */
  async transitBinId(warehouseId: string, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma.client;
    const existing = await db.warehouseBin.findFirst({
      where: { warehouseId, code: TRANSIT_BIN_CODE, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;

    const zone =
      (await db.warehouseZone.findFirst({
        where: { warehouseId, deletedAt: null },
        orderBy: { pickOrder: 'asc' },
        select: { id: true },
      })) ??
      (await db.warehouseZone.create({
        data: { warehouseId, code: DEFAULT_ZONE_CODE, name: 'Main', pickOrder: 100 },
        select: { id: true },
      }));

    const created = await db.warehouseBin.create({
      data: {
        warehouseId,
        zoneId: zone.id,
        code: TRANSIT_BIN_CODE,
        type: BinType.TRANSIT,
        aisle: null,
        rack: null,
        shelf: null,
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Resolve the bin a putaway should land in.
   *
   * Tracking ON  — a bin is REQUIRED. The caller validates which types
   *                it will accept; this only insists that one was given.
   * Tracking OFF — a bin is not required, but an explicitly supplied one
   *                is still honoured. "Off" means we do not ASK for a
   *                location, not that we refuse to record one: a real
   *                bin in the right warehouse is a true fact either way,
   *                and having it already recorded is pure upside on the
   *                day tracking is switched on. Only when nothing is
   *                supplied does the stock land in FLOOR.
   *
   *                The UI does not send a bin while tracking is off — it
   *                offers the optional `notedLocation` instead, which is
   *                a note and never an authority.
   */
  async resolvePutawayBin(
    warehouseId: string,
    requestedBinId: string | null | undefined,
    tx?: Prisma.TransactionClient,
  ): Promise<{ binId: string; trackingEnabled: boolean }> {
    const trackingEnabled = await this.isTrackingEnabled(warehouseId, tx);
    if (!trackingEnabled) {
      return {
        binId: requestedBinId ?? (await this.floorBinId(warehouseId, tx)),
        trackingEnabled,
      };
    }
    if (!requestedBinId) {
      throw new BadRequestException({
        code: 'BIN_REQUIRED',
        message:
          'This warehouse tracks locations — choose the bin the goods were put in (aisle / rack / shelf)',
      });
    }
    return { binId: requestedBinId, trackingEnabled };
  }
}
