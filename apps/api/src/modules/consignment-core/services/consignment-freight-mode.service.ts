import { ConflictException, Injectable } from '@nestjs/common';
import { ActorType, ConsignmentLeg, InboundFreightMode, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

export const SETTING_INBOUND_FREIGHT_MODE = 'wallet.inbound_freight_mode';

/** The modes a consignment may be pinned to. All three, deliberately. */
export const CONSIGNMENT_FREIGHT_MODES: readonly InboundFreightMode[] = [
  InboundFreightMode.PAY_ADVANCE,
  InboundFreightMode.PAY_NOW,
  InboundFreightMode.PAY_LATER,
];

/** The subset of a Prisma client this needs — a transaction works too. */
type ConsignmentReader = Pick<Prisma.TransactionClient, 'consignment'>;

/** Where a resolved mode came from, so a screen can say whose decision it was. */
export type FreightModeSource = 'CONSIGNMENT' | 'SELLER' | 'SYSTEM_DEFAULT';

export interface ResolvedFreightMode {
  readonly mode: InboundFreightMode;
  readonly source: FreightModeSource;
  /** True once a bill exists: the mode is fixed and may not be changed. */
  readonly locked: boolean;
}

/**
 * How ONE consignment's inbound freight is paid for, and therefore WHICH
 * goods receipt its bill hangs on.
 *
 * ── THE THREE-LEVEL CHAIN ─────────────────────────────────────────────
 *
 *     consignment override  ??  seller override  ??  global default
 *
 * The last two are SET-1's, unchanged and not rebuilt here: the key
 * `wallet.inbound_freight_mode` is a seller-overridable STRING resolved
 * by `SettingsResolverService`. This service adds the third level and is
 * the only thing that reads it.
 *
 * An ABSENT consignment override falls THROUGH — never to a hardcoded
 * default. That matters: the column is null on every consignment that
 * nobody has made a per-shipment decision about, which is most of them,
 * and those must follow whatever the seller's terms are today.
 *
 * ── WHEN THE OVERRIDE IS SET, AND WHY THERE ───────────────────────────
 * At BD receiving. Standing at the Dhaka receipt the question is "do we
 * bill this one now, or when it lands?" — PAY_ADVANCE bills there and
 * then, PAY_NOW and PAY_LATER both defer to the India arrival. One
 * decision at one point selects all three, and it is the last moment
 * before the answer starts to matter.
 *
 * All THREE values are accepted, not only the two that differ at Dhaka.
 * Restricting the list would make "global PAY_ADVANCE, this one billed at
 * arrival and paid at once" unreachable, and a level of override that
 * cannot express one of the values it overrides is a gap somebody meets
 * later with no way round it.
 *
 * ── AND WHEN IT FREEZES ───────────────────────────────────────────────
 * The moment the bill is raised. `snapshotAtBilling` writes the EFFECTIVE
 * mode onto the consignment inside the billing transaction, so the column
 * is an override before billing and a SNAPSHOT after — and `setOverride`
 * refuses once a live bill exists (`FREIGHT_MODE_LOCKED`). That is the
 * ORD-6 / RS-5 discipline: a later change to the seller's setting or the
 * global default can never re-characterise a consignment already billed
 * or in the air, and changing how an already-raised bill was going to be
 * paid is meaningless rather than merely unwise.
 *
 * ── WHY ONE READER ────────────────────────────────────────────────────
 * The same discipline that put `Warehouse.fulfilsOrders` behind
 * `WarehouseResolverService` (CNS-2) and bin tracking behind
 * `BinPolicyService` (BIN-1): five call sites each deciding what the mode
 * means is how they come to disagree, and here the disagreement is a
 * seller billed twice or not at all. Three callers need the answer — the
 * billing service (which leg may be billed), the dispatch guard (may the
 * goods leave Dhaka unbilled), and the screens that say what will
 * happen — so it is resolved in one place.
 *
 * ── FAILS TO PAY_NOW ──────────────────────────────────────────────────
 * The same default `InboundFreightService` has always used on a settings
 * outage. It is the simplest money flow and the one in force before this
 * existed; falling to PAY_ADVANCE would block a dispatch over a settings
 * read, and falling to PAY_LATER would quietly extend credit.
 */
@Injectable()
export class ConsignmentFreightModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly audit: AuditLogService,
  ) {}

  /** Levels two and three: the seller's override, else the global default. */
  async resolveForSeller(
    sellerId: string,
  ): Promise<{ mode: InboundFreightMode; source: 'SELLER' | 'SYSTEM_DEFAULT' }> {
    try {
      const resolved = await this.settings.resolve(sellerId, SETTING_INBOUND_FREIGHT_MODE);
      return {
        mode: parseMode(resolved.value),
        source: resolved.source === 'SELLER_OVERRIDE' ? 'SELLER' : 'SYSTEM_DEFAULT',
      };
    } catch {
      return { mode: InboundFreightMode.PAY_NOW, source: 'SYSTEM_DEFAULT' };
    }
  }

  /**
   * The mode in force for a consignment, and where it came from.
   *
   * Takes an optional client so a caller inside a transaction reads the
   * same row it is about to guard on.
   */
  async resolveForConsignment(
    consignmentId: string,
    db?: ConsignmentReader,
  ): Promise<ResolvedFreightMode> {
    const row = await (db ?? this.prisma.client).consignment.findUnique({
      where: { id: consignmentId },
      select: {
        sellerId: true,
        inboundFreightMode: true,
        freightCharges: { where: { voidedAt: null }, select: { id: true }, take: 1 },
      },
    });
    if (row === null) {
      return { mode: InboundFreightMode.PAY_NOW, source: 'SYSTEM_DEFAULT', locked: false };
    }
    const locked = row.freightCharges.length > 0;
    if (row.inboundFreightMode !== null) {
      return { mode: row.inboundFreightMode, source: 'CONSIGNMENT', locked };
    }
    const fallback = await this.resolveForSeller(row.sellerId);
    return { ...fallback, locked };
  }

  /** Just the mode — for the callers that do not care where it came from. */
  async modeFor(consignmentId: string, db?: ConsignmentReader): Promise<InboundFreightMode> {
    return (await this.resolveForConsignment(consignmentId, db)).mode;
  }

  /**
   * Pin ONE consignment's mode, or clear the pin so it falls through
   * again. Refused once a bill exists.
   */
  async setOverride(
    staffId: string,
    consignmentId: string,
    mode: InboundFreightMode | null,
  ): Promise<ResolvedFreightMode> {
    const before = await this.resolveForConsignment(consignmentId);
    if (before.locked) {
      throw new ConflictException({
        code: 'FREIGHT_MODE_LOCKED',
        message:
          'This consignment has already been billed, so how its freight is paid for is settled. ' +
          'Void the bill first if it was raised on the wrong terms.',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      // Guarded on "still unbilled" INSIDE the write: the check above
      // read outside this transaction, and a bill raised in between
      // would otherwise be re-characterised after the fact.
      const claimed = await tx.consignment.updateMany({
        where: { id: consignmentId, freightCharges: { none: { voidedAt: null } } },
        data: { inboundFreightMode: mode },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_MODE_LOCKED',
          message: 'This consignment was billed by somebody else while you were deciding.',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          action: 'inventory.consignment.freight_mode_set',
          entityType: 'consignment',
          entityId: consignmentId,
          severity: 'MEDIUM',
          metadata: {
            // Both the value and where it was coming from: "changed from
            // PAY_NOW" reads very differently when PAY_NOW was the
            // seller's own term rather than this consignment's pin.
            fromMode: before.mode,
            fromSource: before.source,
            toMode: mode,
          },
        },
        tx,
      );
    });

    return this.resolveForConsignment(consignmentId);
  }

  /**
   * Freeze the effective mode onto the consignment, inside the
   * transaction that raises its bill.
   *
   * Writing the resolved value even when it came from the seller or the
   * global default is the point: from here the consignment says what it
   * was billed on, and no later settings change can restate it.
   */
  async snapshotAtBilling(
    tx: ConsignmentReader,
    consignmentId: string,
    mode: InboundFreightMode,
  ): Promise<void> {
    await tx.consignment.update({
      where: { id: consignmentId },
      data: { inboundFreightMode: mode },
    });
  }

  /**
   * Which goods-receipt LEG a mode's bill hangs on.
   *
   * PAY_ADVANCE bills the Bangladesh intake — the count and the weight
   * that price it are taken there, and the bill is raised before the
   * goods fly. Everything else bills the India arrival, which is what a
   * forwarder actually invoices.
   *
   * F2-exhaustive: a fourth mode fails to compile until somebody decides
   * which leg it is billed on, because guessing here is a seller billed
   * against a count that was never taken.
   */
  legFor(mode: InboundFreightMode): ConsignmentLeg {
    switch (mode) {
      case InboundFreightMode.PAY_ADVANCE:
        return ConsignmentLeg.BD_INTAKE;
      case InboundFreightMode.PAY_NOW:
      case InboundFreightMode.PAY_LATER:
        return ConsignmentLeg.IN_FINAL;
      default: {
        const exhaustive: never = mode;
        throw new Error(`Unhandled InboundFreightMode: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Whether a mode is settled in FULL the moment the bill is recorded.
   *
   * PAY_ADVANCE joins PAY_NOW: both debit the whole bill at once and are
   * never amortised. Asked here rather than tested inline, so the two
   * places that care — recording the bill, and the amortisation walk that
   * must skip it — cannot come to disagree about which modes pay up front.
   */
  settlesImmediately(mode: InboundFreightMode): boolean {
    return mode === InboundFreightMode.PAY_NOW || mode === InboundFreightMode.PAY_ADVANCE;
  }
}

/** A stored setting value read as a mode; anything unrecognised is PAY_NOW. */
export function parseMode(value: unknown): InboundFreightMode {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (raw === InboundFreightMode.PAY_LATER) return InboundFreightMode.PAY_LATER;
  if (raw === InboundFreightMode.PAY_ADVANCE) return InboundFreightMode.PAY_ADVANCE;
  return InboundFreightMode.PAY_NOW;
}
