import { Injectable } from '@nestjs/common';
import { ReattemptRequestStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';

const SETTING_MAX_ATTEMPTS = 'ops.call_max_attempts_before_ndr';
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * How many calls an ORDER gets before it is out of chances.
 *
 * The seller's cap plus whatever headroom an approved re-attempt request
 * granted. One service owns the formula because two consumers need the
 * same number and they fail differently when it drifts: the attempt
 * service ENFORCES it, and the queue screen DISPLAYS it. A screen
 * reading "3/3" beside an order the server will happily call twice more
 * is the kind of disagreement nobody reports as a bug — they just stop
 * trusting the number.
 *
 * (The queue's own `call_queue_entries.max_attempts` column is NOT this
 * number. It is a per-entry default that predates both the per-seller
 * override and the grants, and nothing enforces against it.)
 */
@Injectable()
export class CallCapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  /** The seller's own cap, before any per-order grant. */
  async baseForSeller(sellerId: string): Promise<number> {
    const seller = await this.prisma.client.seller.findUnique({
      where: { id: sellerId },
      select: { callMaxAttemptsBeforeNdrOverride: true },
    });
    return this.settings.resolveIntWithLegacy(
      sellerId,
      SETTING_MAX_ATTEMPTS,
      seller?.callMaxAttemptsBeforeNdrOverride,
      DEFAULT_MAX_ATTEMPTS,
    );
  }

  /**
   * Extra calls granted to this order by APPROVED re-attempt requests.
   *
   * Summed across approvals rather than taking the latest: an order
   * approved twice has been argued for twice, and each grant was a
   * decision somebody made. Pending and rejected requests carry zero by
   * construction — the column is only written on approval.
   */
  async grantedExtra(orderId: string): Promise<number> {
    const agg = await this.prisma.client.orderReattemptRequest.aggregate({
      where: { orderId, status: ReattemptRequestStatus.APPROVED },
      _sum: { extraAttempts: true },
    });
    return agg._sum.extraAttempts ?? 0;
  }

  /** The number the cap is actually judged against. */
  async effectiveForOrder(sellerId: string, orderId: string): Promise<number> {
    const [base, extra] = await Promise.all([
      this.baseForSeller(sellerId),
      this.grantedExtra(orderId),
    ]);
    return base + extra;
  }

  /** Batch form for a list screen — one aggregate query per order is a
   *  query per row, and the queue renders 25 at a time. */
  async grantedExtraByOrder(orderIds: string[]): Promise<ReadonlyMap<string, number>> {
    const ids = [...new Set(orderIds)];
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const rows = await this.prisma.client.orderReattemptRequest.groupBy({
      by: ['orderId'],
      where: { orderId: { in: ids }, status: ReattemptRequestStatus.APPROVED },
      _sum: { extraAttempts: true },
    });
    for (const r of rows) out.set(r.orderId, r._sum.extraAttempts ?? 0);
    return out;
  }
}
