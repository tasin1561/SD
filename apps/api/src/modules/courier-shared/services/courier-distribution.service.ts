import { Injectable, Logger } from '@nestjs/common';
import { CredentialEnvironment, PaymentMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface DistributedAccount {
  readonly courierAccountId: string;
  readonly courierCode: string;
  readonly courierId: string;
  readonly label: string;
  /** Where the choice came from, for the audit trail and for debugging. */
  readonly source: 'SELLER_DISTRIBUTION' | 'GLOBAL_SPLIT' | 'ONLY_ACTIVE';
}

const SETTING_DEFAULT_DELHIVERY = 'courier.default_account_delhivery';
const SETTING_DEFAULT_SHIPROCKET = 'courier.default_account_shiprocket';
const SETTING_DELHIVERY_SHARE = 'courier.delhivery_share_percent';

/**
 * Which account carries THIS parcel.
 *
 * Two levels, and the seller's beats the global one:
 *
 *   - A seller with their own distribution gets exactly it. Those are
 *     `seller_courier_account_links` with `distribution_weight`, which
 *     have existed since R1 and were only ever consulted within a single
 *     courier. Read across couriers, they express "Delhivery A 50,
 *     Delhivery B 30, Shiprocket A 20, Shiprocket C 10" directly.
 *   - Everyone else follows the global split between the two default
 *     accounts.
 *
 * ── WEIGHTS ARE RELATIVE, NOT PERCENTAGES ────────────────────────────
 * They are normalised against their own total, so 50/30/20/10 works and
 * so does 5/3/2/1. Demanding they sum to 100 would mean a seller cannot
 * remove an account without editing every other one, and the failure
 * mode of getting it wrong — a silent refusal, or a parcel with no
 * account — is far worse than the arithmetic being approximate.
 *
 * ── DRAWN PER PARCEL, NOT COUNTED ────────────────────────────────────
 * A weighted random draw, so the split is approached over volume rather
 * than enforced exactly. The alternative is a running counter, and a
 * counter is shared state that two API instances would fight over — for
 * a guarantee nobody actually needs, since what matters is the ratio
 * over a month, not that parcel 7 went to Delhivery.
 */
@Injectable()
export class CourierDistributionService {
  private readonly logger = new Logger(CourierDistributionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async pick(
    sellerId: string,
    input: { paymentMode: PaymentMode; environment?: CredentialEnvironment },
  ): Promise<DistributedAccount | null> {
    const environment = input.environment ?? CredentialEnvironment.PRODUCTION;

    const seller = await this.sellerCandidates(sellerId, environment, input.paymentMode);
    if (seller.length > 0) {
      const chosen = this.weightedDraw(seller);
      return { ...chosen.account, source: 'SELLER_DISTRIBUTION' };
    }

    return this.globalSplit(environment, input.paymentMode);
  }

  /**
   * Any usable account for one named courier, seller-independent.
   *
   * The serviceability check asks "would this courier carry a parcel to
   * this pin at all", which is a question about the COURIER rather than
   * about a seller's routing — so it deliberately skips the weighted
   * draw. Returns null when the courier has no active account, which
   * the caller reads as "could not ask", never as a refusal.
   */
  async anyAccountFor(
    courierCode: string,
    environment: CredentialEnvironment = CredentialEnvironment.PRODUCTION,
  ): Promise<{ courierAccountId: string; courierCode: string } | null> {
    const account = await this.prisma.client.courierAccount.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        environment,
        // isActive too: a courier switched off should not be consulted
        // about whether it would carry a parcel it will never be given.
        courier: { code: courierCode, deletedAt: null, isActive: true },
      },
      select: { id: true },
      // Deterministic, so two calls a second apart do not consult two
      // different accounts and disagree about the same pin.
      orderBy: { createdAt: 'asc' },
    });
    return account === null ? null : { courierAccountId: account.id, courierCode };
  }

  /** Every account this seller is linked to, across all couriers. */
  private async sellerCandidates(
    sellerId: string,
    environment: CredentialEnvironment,
    paymentMode: PaymentMode,
  ): Promise<Array<{ weight: number; account: Omit<DistributedAccount, 'source'> }>> {
    const links = await this.prisma.client.sellerCourierAccountLink.findMany({
      where: {
        sellerId,
        isActive: true,
        courierAccount: { environment, isActive: true, deletedAt: null },
      },
      select: {
        distributionWeight: true,
        courierAccount: {
          select: {
            id: true,
            label: true,
            courierId: true,
            courier: {
              select: {
                code: true,
                isActive: true,
                deletedAt: true,
                supportsCod: true,
                supportsPrepaid: true,
              },
            },
          },
        },
      },
    });

    return (
      links
        .filter((l) => {
          const c = l.courierAccount.courier;
          if (!c.isActive || c.deletedAt !== null) return false;
          // A prepaid-only courier on a COD order is a rejected AWB and a
          // manual placement, discovered after the parcel is picked.
          return paymentMode === PaymentMode.COD ? c.supportsCod : c.supportsPrepaid;
        })
        // A zero weight is how a seller switches an account OFF without
        // unlinking it, so it must not be drawn.
        .filter((l) => l.distributionWeight > 0)
        .map((l) => ({
          weight: l.distributionWeight,
          account: {
            courierAccountId: l.courierAccount.id,
            courierCode: l.courierAccount.courier.code,
            courierId: l.courierAccount.courierId,
            label: l.courierAccount.label,
          },
        }))
    );
  }

  /** The two configured defaults, split by the configured percentage. */
  private async globalSplit(
    environment: CredentialEnvironment,
    paymentMode: PaymentMode,
  ): Promise<DistributedAccount | null> {
    const [delhiveryId, shiprocketId, sharePercent] = await Promise.all([
      this.settingString(SETTING_DEFAULT_DELHIVERY),
      this.settingString(SETTING_DEFAULT_SHIPROCKET),
      this.settingInt(SETTING_DELHIVERY_SHARE, 100),
    ]);

    const ids = [delhiveryId, shiprocketId].filter((v): v is string => v !== null && v !== '');
    const accounts =
      ids.length === 0
        ? []
        : await this.prisma.client.courierAccount.findMany({
            where: { id: { in: ids }, environment, isActive: true, deletedAt: null },
            select: {
              id: true,
              label: true,
              courierId: true,
              courier: {
                select: {
                  code: true,
                  isActive: true,
                  deletedAt: true,
                  supportsCod: true,
                  supportsPrepaid: true,
                },
              },
            },
          });

    const usable = accounts.filter((a) => {
      if (!a.courier.isActive || a.courier.deletedAt !== null) return false;
      return paymentMode === PaymentMode.COD ? a.courier.supportsCod : a.courier.supportsPrepaid;
    });

    if (usable.length === 0) {
      // Nothing configured, or what is configured cannot carry this
      // parcel. The caller falls back to any active account — a missing
      // setting must not stop the parcel.
      return this.onlyActive(environment, paymentMode);
    }
    if (usable.length === 1) {
      const only = usable[0];
      if (!only) return null;
      return {
        courierAccountId: only.id,
        courierCode: only.courier.code,
        courierId: only.courierId,
        label: only.label,
        source: 'GLOBAL_SPLIT',
      };
    }

    // Clamped, because a share outside 0..100 is a typo rather than an
    // intention, and honouring it would send everything one way while
    // the setting claims otherwise.
    const share = Math.max(0, Math.min(100, sharePercent));
    const candidates = usable.map((a) => ({
      weight: a.courier.code === 'delhivery' ? share : 100 - share,
      account: {
        courierAccountId: a.id,
        courierCode: a.courier.code,
        courierId: a.courierId,
        label: a.label,
      },
    }));
    const drawable = candidates.filter((c) => c.weight > 0);
    if (drawable.length === 0) return null;
    return { ...this.weightedDraw(drawable).account, source: 'GLOBAL_SPLIT' };
  }

  /**
   * Any active account that can carry this parcel.
   *
   * The floor. Reached when nothing is configured — which is the state
   * a fresh install is in, and a parcel must still ship.
   */
  private async onlyActive(
    environment: CredentialEnvironment,
    paymentMode: PaymentMode,
  ): Promise<DistributedAccount | null> {
    const a = await this.prisma.client.courierAccount.findFirst({
      where: {
        environment,
        isActive: true,
        deletedAt: null,
        courier: {
          isActive: true,
          deletedAt: null,
          ...(paymentMode === PaymentMode.COD ? { supportsCod: true } : { supportsPrepaid: true }),
        },
      },
      orderBy: { courier: { priorityForRouting: 'asc' } },
      select: {
        id: true,
        label: true,
        courierId: true,
        courier: { select: { code: true } },
      },
    });
    if (!a) {
      this.logger.error(
        { paymentMode },
        'No active courier account can carry this parcel — nothing is configured',
      );
      return null;
    }
    return {
      courierAccountId: a.id,
      courierCode: a.courier.code,
      courierId: a.courierId,
      label: a.label,
      source: 'ONLY_ACTIVE',
    };
  }

  /**
   * An account on a DIFFERENT courier, for when the first one refuses.
   *
   * Different COURIER, not merely a different account: a second
   * Delhivery account will refuse a pincode Delhivery does not serve for
   * exactly the same reason the first did, so retrying there spends a
   * call to learn what we already know.
   */
  async pickAlternate(
    sellerId: string,
    input: {
      paymentMode: PaymentMode;
      excludeCourierId: string;
      environment?: CredentialEnvironment;
    },
  ): Promise<DistributedAccount | null> {
    const environment = input.environment ?? CredentialEnvironment.PRODUCTION;

    const seller = (await this.sellerCandidates(sellerId, environment, input.paymentMode)).filter(
      (c) => c.account.courierId !== input.excludeCourierId,
    );
    if (seller.length > 0) {
      return { ...this.weightedDraw(seller).account, source: 'SELLER_DISTRIBUTION' };
    }

    const a = await this.prisma.client.courierAccount.findFirst({
      where: {
        environment,
        isActive: true,
        deletedAt: null,
        courierId: { not: input.excludeCourierId },
        courier: {
          isActive: true,
          deletedAt: null,
          ...(input.paymentMode === PaymentMode.COD
            ? { supportsCod: true }
            : { supportsPrepaid: true }),
        },
      },
      orderBy: { courier: { priorityForRouting: 'asc' } },
      select: { id: true, label: true, courierId: true, courier: { select: { code: true } } },
    });
    if (!a) return null;
    return {
      courierAccountId: a.id,
      courierCode: a.courier.code,
      courierId: a.courierId,
      label: a.label,
      source: 'GLOBAL_SPLIT',
    };
  }

  /** Normalised against the total, so weights need not sum to anything. */
  private weightedDraw<T>(candidates: ReadonlyArray<{ weight: number; account: T }>): {
    weight: number;
    account: T;
  } {
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    const first = candidates[0];
    if (first === undefined) throw new Error('weightedDraw called with nothing to draw from');
    if (total <= 0) return first;
    let roll = Math.random() * total;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    // Floating-point drift on the last boundary. Returning the final
    // candidate is correct: the roll was inside its slice.
    return candidates[candidates.length - 1] ?? first;
  }

  private async settingString(key: string): Promise<string | null> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueString: true },
    });
    return row?.valueString ?? null;
  }

  private async settingInt(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }
}
