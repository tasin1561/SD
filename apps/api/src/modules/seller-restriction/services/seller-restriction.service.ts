import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ActorType, Currency, Prisma, SellerCapability } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';

const MIN_REASON_LEN = 20;

/**
 * Capabilities that touch work ALREADY IN FLIGHT.
 *
 * Blocking these does not protect the money — a parcel with the courier
 * still has to be delivered, tracked and returned, and halting that
 * leaves goods stranded we are still paying to move. They are offered
 * because an operator occasionally needs them, and named here so the
 * admin screen can say what they cost instead of listing all seven as
 * if they were the same kind of decision.
 */
export const IN_FLIGHT_CAPABILITIES: ReadonlySet<SellerCapability> = new Set([
  SellerCapability.SHIPMENT_DISPATCH,
  SellerCapability.TRACKING_VIEW,
  SellerCapability.RTO_RECEIVE,
]);

export interface ActiveRestriction {
  readonly id: string;
  readonly blockedCapabilities: readonly SellerCapability[];
  readonly clearAtBalanceInr: string;
  readonly balanceInr: string;
  /** What is still needed to clear it. Zero once reached. */
  readonly shortfallInr: string;
  readonly reason: string;
  readonly createdAt: Date;
}

/**
 * Whether a seller who owes us money may start new work.
 *
 * ONE reader for the whole system, for the same reason `BinPolicyService`
 * owns bin tracking and `WarehouseResolverService` owns "can this
 * warehouse ship": five call sites each deciding what "blocked" means is
 * how they come to disagree, and a restriction that holds in four places
 * out of five is not a restriction.
 *
 * Applied by a person, CLEARED BY MONEY. That asymmetry is the design:
 * an automatic block at 2am over a rounding error would be discovered by
 * a failed order, but making a seller wait for someone to notice their
 * payment is how a solvent account stays frozen over a weekend.
 */
@Injectable()
export class SellerRestrictionService {
  private readonly logger = new Logger(SellerRestrictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * The restriction in force, or null.
   *
   * Lifts it in passing if the balance has reached the threshold, so a
   * seller who tops up is unblocked by their next action rather than by
   * a sweep that runs on the hour. Reading is the only moment we can be
   * sure someone cares about the answer.
   */
  async activeFor(sellerId: string): Promise<ActiveRestriction | null> {
    const row = await this.prisma.client.sellerRestriction.findFirst({
      where: { sellerId, liftedAt: null },
      select: {
        id: true,
        blockedCapabilities: true,
        clearAtBalanceInr: true,
        reason: true,
        createdAt: true,
      },
    });
    if (row === null) return null;

    const balance = await this.wallet.balanceCached(sellerId, Currency.INR);
    if (balance.gte(row.clearAtBalanceInr)) {
      await this.clearByBalance(row.id, sellerId, balance);
      return null;
    }

    return {
      id: row.id,
      blockedCapabilities: row.blockedCapabilities,
      clearAtBalanceInr: row.clearAtBalanceInr.toFixed(2),
      balanceInr: balance.toFixed(2),
      shortfallInr: row.clearAtBalanceInr.minus(balance).toFixed(2),
      reason: row.reason,
      createdAt: row.createdAt,
    };
  }

  /**
   * The guard every entry point calls.
   *
   * Throws a 403 carrying the reason and the exact shortfall, because a
   * blocked action that only says "forbidden" is how you lose a seller
   * who would have paid. The message is the fix, not the refusal.
   */
  async assertAllowed(sellerId: string, capability: SellerCapability): Promise<void> {
    const active = await this.activeFor(sellerId);
    if (active === null) return;
    if (!active.blockedCapabilities.includes(capability)) return;

    throw new ForbiddenException({
      code: 'SELLER_RESTRICTED',
      message:
        `Your account is on hold: ${active.reason} Top up ₹${active.shortfallInr} more to lift it ` +
        `— your balance clears the hold at ₹${active.clearAtBalanceInr}.`,
      cause: {
        capability,
        shortfallInr: active.shortfallInr,
        clearAtBalanceInr: active.clearAtBalanceInr,
        balanceInr: active.balanceInr,
      },
    });
  }

  /** Place a seller on hold. */
  async apply(input: {
    sellerId: string;
    capabilities: readonly SellerCapability[];
    clearAtBalanceInr: string;
    reason: string;
    staffId: string;
  }): Promise<{ id: string }> {
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON_LEN) {
      throw new BadRequestException({
        code: 'RESTRICTION_REASON_TOO_SHORT',
        message:
          `Give a reason of at least ${MIN_REASON_LEN} characters. The seller reads it — a hold ` +
          `they cannot understand is one they will phone about instead of fixing.`,
      });
    }
    if (input.capabilities.length === 0) {
      throw new BadRequestException({
        code: 'RESTRICTION_NOTHING_BLOCKED',
        message: 'Choose at least one thing to block, or there is no hold.',
      });
    }
    let threshold: Prisma.Decimal;
    try {
      threshold = new Prisma.Decimal(input.clearAtBalanceInr);
    } catch {
      throw new BadRequestException({
        code: 'RESTRICTION_THRESHOLD_INVALID',
        message: `'${input.clearAtBalanceInr}' is not a valid balance`,
      });
    }
    if (!threshold.isFinite()) {
      throw new BadRequestException({
        code: 'RESTRICTION_THRESHOLD_INVALID',
        message: 'The clearing balance must be a number',
      });
    }

    // The partial unique is the real gate — two operators can both read
    // "no active hold" and both insert. This is the readable error for
    // the one that loses.
    const existing = await this.prisma.client.sellerRestriction.findFirst({
      where: { sellerId: input.sellerId, liftedAt: null },
      select: { id: true },
    });
    if (existing !== null) {
      throw new BadRequestException({
        code: 'RESTRICTION_ALREADY_ACTIVE',
        message: 'This seller is already on hold. Lift the existing one first, or edit it.',
        cause: { restrictionId: existing.id },
      });
    }

    const row = await this.prisma.client.sellerRestriction.create({
      data: {
        sellerId: input.sellerId,
        blockedCapabilities: [...input.capabilities],
        clearAtBalanceInr: threshold,
        reason,
        createdByStaffId: input.staffId,
      },
      select: { id: true },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      sellerId: input.sellerId,
      action: 'seller.restriction.applied',
      entityType: 'seller_restriction',
      entityId: row.id,
      // A hold stops a seller trading. That is not a MEDIUM decision.
      severity: 'HIGH',
      metadata: {
        capabilities: [...input.capabilities],
        clearAtBalanceInr: threshold.toFixed(2),
        reason,
        touchesInFlightWork: input.capabilities.some((c) => IN_FLIGHT_CAPABILITIES.has(c)),
      },
    });
    return row;
  }

  /** Lift by hand, before the balance gets there. */
  async lift(input: { restrictionId: string; staffId: string; reason: string }): Promise<void> {
    const claimed = await this.prisma.client.sellerRestriction.updateMany({
      where: { id: input.restrictionId, liftedAt: null },
      data: {
        liftedAt: new Date(),
        liftedByStaffId: input.staffId,
        liftReason: input.reason.trim(),
      },
    });
    if (claimed.count === 0) {
      throw new BadRequestException({
        code: 'RESTRICTION_NOT_ACTIVE',
        message: 'That hold has already been lifted.',
      });
    }
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      action: 'seller.restriction.lifted',
      entityType: 'seller_restriction',
      entityId: input.restrictionId,
      severity: 'MEDIUM',
      metadata: { reason: input.reason.trim(), by: 'STAFF' },
    });
  }

  /**
   * Lifted by the seller's own money.
   *
   * Guarded `updateMany` rather than a read-then-write: two requests can
   * arrive together the moment a top-up lands, and both would see an
   * active hold. Whoever loses simply finds nothing to update.
   */
  private async clearByBalance(
    restrictionId: string,
    sellerId: string,
    balance: Prisma.Decimal,
  ): Promise<void> {
    try {
      const claimed = await this.prisma.client.sellerRestriction.updateMany({
        where: { id: restrictionId, liftedAt: null },
        data: {
          liftedAt: new Date(),
          liftReason: `Balance reached ₹${balance.toFixed(2)}`,
        },
      });
      if (claimed.count === 0) return;
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        sellerId,
        action: 'seller.restriction.lifted',
        entityType: 'seller_restriction',
        entityId: restrictionId,
        severity: 'MEDIUM',
        metadata: { balanceInr: balance.toFixed(2), by: 'BALANCE' },
      });
    } catch (e) {
      // Never block the caller: they were asking whether they may do
      // something, and the answer is yes either way.
      this.logger.warn(
        { restrictionId, err: (e as Error).message },
        'Auto-lift failed; the hold stays and will clear on the next read',
      );
    }
  }
}
