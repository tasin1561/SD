import { Injectable, Logger } from '@nestjs/common';
import { CredentialEnvironment, PaymentMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierAccountRoutingService } from './courier-account-routing.service';

export interface SelectedCourier {
  readonly courierCode: string;
  readonly courierId: string;
  readonly courierAccountId: string | null;
  /** Why this one, in a word — for the audit trail and for debugging. */
  readonly reason: 'SELLER_LINK' | 'PRIORITY' | 'DEFAULT';
}

const SETTING_DEFAULT_COURIER = 'ops.default_courier_code';

/**
 * Which courier carries this parcel.
 *
 * Everything went to `ops.default_courier_code` because there was only
 * ever one integrated courier. With a second, that stops being a
 * configuration and becomes a decision.
 *
 * ── HOW IT DECIDES ───────────────────────────────────────────────────
 * 1. The couriers this SELLER actually has accounts with. Those links
 *    already exist (R1/CACC-1) and already carry distribution weights;
 *    a seller linked to Shiprocket accounts is a seller who ships
 *    Shiprocket. This is the answer in almost every case.
 * 2. Failing that, the highest-priority active courier that supports
 *    the payment mode — `priority_for_routing` has been in the schema
 *    unread since M0.
 * 3. Failing that, the configured default, which is where we started.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────
 * It does not ask anyone whether they can deliver. Serviceability is
 * REACTIVE by design (CUR-5): an AWB rejection routes the order to
 * manual placement, and that has been the behaviour since M9. Making
 * selection depend on a live answer would put a courier call on the
 * path of every shipment provision — and provisioning happens inside
 * `transitionStatus`, where a slow courier would hold an order
 * transition open.
 *
 * Trying courier B when courier A refuses is the obvious next step and
 * is deliberately NOT here. It changes the AWB saga's supersede
 * chain (CUR-7), which is conservation-adjacent and deserves its own
 * pass rather than riding along with a selection function.
 */
@Injectable()
export class CourierSelectionService {
  private readonly logger = new Logger(CourierSelectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CourierAccountRoutingService,
  ) {}

  async selectForSeller(
    sellerId: string,
    input: { paymentMode: PaymentMode; environment?: CredentialEnvironment },
  ): Promise<SelectedCourier> {
    const environment = input.environment ?? CredentialEnvironment.PRODUCTION;

    // 1. What this seller is actually set up with.
    const links = await this.prisma.client.sellerCourierAccountLink.findMany({
      where: {
        sellerId,
        isActive: true,
        courierAccount: { environment, isActive: true, deletedAt: null },
      },
      select: {
        courierAccount: {
          select: {
            courierId: true,
            courier: {
              select: {
                id: true,
                code: true,
                isActive: true,
                supportsCod: true,
                supportsPrepaid: true,
                priorityForRouting: true,
              },
            },
          },
        },
      },
    });

    const usable = links
      .map((l) => l.courierAccount.courier)
      .filter((c) => c.isActive && this.supports(c, input.paymentMode));

    if (usable.length > 0) {
      // Lowest number wins, which is what "priority" means everywhere
      // else in this schema.
      const best = usable.reduce((a, b) => (a.priorityForRouting <= b.priorityForRouting ? a : b));
      const account = await this.accounts.selectAccount(sellerId, best.id, environment);
      return {
        courierCode: best.code,
        courierId: best.id,
        courierAccountId: account.courierAccountId,
        reason: 'SELLER_LINK',
      };
    }

    // 2. Nobody linked them to anything. Take the best active courier
    //    that can carry this payment mode.
    const byPriority = await this.prisma.client.courier.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...(input.paymentMode === PaymentMode.COD
          ? { supportsCod: true }
          : { supportsPrepaid: true }),
      },
      orderBy: { priorityForRouting: 'asc' },
      take: 1,
      select: { id: true, code: true },
    });
    const top = byPriority[0];
    if (top) {
      const account = await this.accounts
        .selectAccount(sellerId, top.id, environment)
        .catch(() => null);
      return {
        courierCode: top.code,
        courierId: top.id,
        courierAccountId: account?.courierAccountId ?? null,
        reason: 'PRIORITY',
      };
    }

    // 3. Where we started. Reached only when no courier is active at
    //    all, which is a configuration problem rather than a routing
    //    one — but returning the configured default keeps the parcel
    //    moving instead of failing the provision.
    const setting = await this.prisma.client.systemSetting.findUnique({
      where: { key: SETTING_DEFAULT_COURIER },
      select: { valueString: true },
    });
    const code = (setting?.valueString ?? 'delhivery').trim();
    const courier = await this.prisma.client.courier.findUnique({
      where: { code },
      select: { id: true, code: true },
    });
    this.logger.warn(
      { sellerId, paymentMode: input.paymentMode, code },
      'No active courier matched; falling back to the configured default',
    );
    return {
      courierCode: code,
      courierId: courier?.id ?? '',
      courierAccountId: null,
      reason: 'DEFAULT',
    };
  }

  private supports(
    c: { supportsCod: boolean; supportsPrepaid: boolean },
    mode: PaymentMode,
  ): boolean {
    return mode === PaymentMode.COD ? c.supportsCod : c.supportsPrepaid;
  }
}
