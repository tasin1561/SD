import { CourierIntegrationType } from '@skydrop/db';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Whether a courier may take NEW parcels.
 *
 * ── WHAT "OFF" MEANS, AND WHAT IT DELIBERATELY DOES NOT ──────────────
 * OFF means: route nothing new here. No distribution draw, no failover
 * target, no AWB booked, not consulted for serviceability.
 *
 * OFF does NOT mean: stop tracking the parcels they already have. A
 * courier switched off mid-week is still holding real parcels moving
 * towards real customers, and going quiet on those would be the same
 * failure as never polling them — they would sit at DISPATCHED with a
 * timeline that stops, and the first symptom is a seller asking why.
 * So the tracking poll, the NDR runner, cancels and the ops panel all
 * keep working for in-flight parcels. The switch is about intake.
 *
 * ── WHY ONE READER ───────────────────────────────────────────────────
 * `Courier.isActive` already existed and was already checked in the two
 * distribution paths — and NOT in the AWB dispatcher, which is the
 * place a parcel actually gets booked. Five call sites each testing a
 * flag themselves is how they come to disagree; this is the same
 * discipline as `WarehouseResolverService` for `fulfilsOrders` (CNS-2)
 * and `BinPolicyService` for bin tracking (BIN-1).
 *
 * The flag is the COLUMN, deliberately, not a new `courier.<code>_enabled`
 * system setting. A second source of truth for "can this courier carry a
 * parcel" is exactly the drift those two invariants exist to prevent —
 * and the column is the one the distribution queries already join on.
 */
@Injectable()
export class CourierEnablementService {
  private readonly logger = new Logger(CourierEnablementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * May this courier take a new parcel?
   *
   * Fails CLOSED on an unknown or soft-deleted courier: being unable to
   * confirm a courier is enabled is not a reason to book a parcel with
   * them.
   */
  async canTakeNewParcels(courierCode: string): Promise<boolean> {
    const row = await this.prisma.client.courier.findUnique({
      where: { code: courierCode },
      select: { isActive: true, deletedAt: true },
    });
    if (row === null || row.deletedAt !== null) return false;
    return row.isActive;
  }

  /** Every courier and whether it is taking parcels — for the console. */
  async list(): Promise<
    ReadonlyArray<{
      readonly code: string;
      readonly name: string;
      readonly isActive: boolean;
      readonly supportsCod: boolean;
      readonly supportsPrepaid: boolean;
      /**
       * Whether there is an API behind this courier at all. A MANUAL
       * one holds no credentials, so the account form must not ask for
       * any — driven off this rather than off the code 'manual', so a
       * second manual carrier inherits it by declaration.
       */
      readonly integrationType: CourierIntegrationType;
    }>
  > {
    const rows = await this.prisma.client.courier.findMany({
      where: { deletedAt: null },
      select: {
        code: true,
        name: true,
        isActive: true,
        supportsCod: true,
        supportsPrepaid: true,
        integrationType: true,
      },
      orderBy: { code: 'asc' },
    });
    return rows;
  }

  /**
   * Turn a courier's intake on or off.
   *
   * A guarded `updateMany` rather than a read-then-write: two operators
   * toggling at once should not both believe they set the final state.
   * `count === 0` means it was already there, which is not an error —
   * the caller reports `changed: false` and the end state is what was
   * asked for either way.
   */
  async setActive(courierCode: string, isActive: boolean): Promise<{ changed: boolean }> {
    const { count } = await this.prisma.client.courier.updateMany({
      where: { code: courierCode, deletedAt: null, isActive: !isActive },
      data: { isActive },
    });
    if (count > 0) {
      this.logger.warn(
        { courierCode, isActive },
        isActive
          ? 'Courier ENABLED — it will start receiving new parcels'
          : 'Courier DISABLED — it takes no new parcels; in-flight ones keep being tracked',
      );
    }
    return { changed: count > 0 };
  }
}
