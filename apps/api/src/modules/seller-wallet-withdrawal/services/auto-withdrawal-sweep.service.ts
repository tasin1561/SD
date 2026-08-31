import { Injectable, Logger } from '@nestjs/common';
import { Currency, Prisma, SellerStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WithdrawalRequestService } from './withdrawal-request.service';

/**
 * Withdrawing without being asked.
 *
 * A seller turns this on and picks an hour; every day at that hour,
 * whatever sits above their minimum balance is requested automatically.
 * It saves them logging in to ask for money that was always going to be
 * theirs.
 *
 * ── The hour is THEIRS, not ours ──────────────────────────────────────
 * Sellers are in Bangladesh, the warehouse is in India, and the server
 * is in neither reliably. "10am" has to mean 10am where the seller
 * lives, so the sweep runs hourly and asks each seller's own timezone
 * what time it is for them.
 *
 * ── Same guards as a manual request ───────────────────────────────────
 * It goes through `createAuto`, which shares the whole guard chain with
 * the human path — balance floor, minimum amount, daily and monthly
 * counts. An automatic request that could take money a manual one could
 * not would be exactly backwards.
 *
 * ── Idempotent by construction ────────────────────────────────────────
 * A seller gets at most one automatic request per 20 hours. The cron
 * fires hourly and a duplicate delivery is normal in BullMQ; without
 * this a retry inside the same hour would raise a second request for the
 * remaining balance, which is zero — harmless — or worse, for a balance
 * that just arrived.
 */

const ENABLED_KEY = 'wallet.auto_withdraw_enabled';
const HOUR_KEY = 'wallet.auto_withdraw_hour_local';
const MIN_THRESHOLD_KEY = 'wallet.withdrawal_min_threshold_inr';
/** The seller's own working float, on top of our floor. */
const KEEP_BALANCE_KEY = 'wallet.auto_withdraw_keep_balance_inr';
const MIN_BALANCE_KEY = 'wallet.minimum_balance_inr';
/** One automatic request per seller per (roughly) day. */
const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;

export interface AutoWithdrawalSweepResult {
  readonly considered: number;
  readonly requested: number;
  readonly skipped: number;
  readonly failures: number;
}

@Injectable()
export class AutoWithdrawalSweepService {
  private readonly logger = new Logger(AutoWithdrawalSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly withdrawals: WithdrawalRequestService,
  ) {}

  async sweep(now: Date = new Date()): Promise<AutoWithdrawalSweepResult> {
    const sellers = await this.prisma.client.seller.findMany({
      // A suspended seller can still pay us in (top-ups) but does not
      // get money swept out automatically — if we suspended them there
      // is usually a reason to look before paying.
      where: { status: SellerStatus.APPROVED, deletedAt: null },
      select: { id: true, timezone: true },
    });

    let requested = 0;
    let skipped = 0;
    let failures = 0;

    for (const seller of sellers) {
      try {
        const enabled = await this.settings.resolve(seller.id, ENABLED_KEY);
        if (enabled.value !== true && enabled.value !== 'true') {
          skipped += 1;
          continue;
        }
        const wanted = Number((await this.settings.resolve(seller.id, HOUR_KEY)).value ?? 10);
        if (this.localHour(now, seller.timezone) !== wanted) {
          skipped += 1;
          continue;
        }
        const recent = await this.prisma.client.withdrawalRequest.findFirst({
          where: {
            sellerId: seller.id,
            requestedBy: 'SYSTEM',
            createdAt: { gte: new Date(now.getTime() - DEDUP_WINDOW_MS) },
          },
          select: { id: true },
        });
        if (recent) {
          skipped += 1;
          continue;
        }

        // What the GUARD would allow, then what this seller asked us to
        // leave behind on top of it.
        //
        // `withdrawableBalance` already subtracts OUR minimum (WAL-3) —
        // it is one number with three callers and must keep meaning one
        // thing, so the seller's own float is subtracted HERE rather
        // than folded into it. The sweep therefore always asks for LESS
        // than the guard permits, which is the safe direction: a sweep
        // that asked for more would be refused by the very check it
        // shares with a manual request.
        const guardAllows = await this.withdrawals.withdrawableBalance(seller.id, Currency.INR);
        const keep = new Prisma.Decimal(
          String((await this.settings.resolve(seller.id, KEEP_BALANCE_KEY)).value ?? 0),
        );
        const ourFloor = new Prisma.Decimal(
          String((await this.settings.resolve(seller.id, MIN_BALANCE_KEY)).value ?? 0),
        );
        // Only the EXCESS over our floor is an extra subtraction: our
        // minimum is already out of `guardAllows`, and taking it twice
        // would quietly halve what a seller can sweep.
        const extra = keep.sub(ourFloor);
        const available = extra.greaterThan(0) ? guardAllows.sub(extra) : guardAllows;
        const minAmount = Number(
          (await this.settings.resolve(seller.id, MIN_THRESHOLD_KEY)).value ?? 0,
        );
        if (available.lessThan(minAmount) || available.lessThanOrEqualTo(0)) {
          // Nothing worth sweeping. Not a failure — most days, for most
          // sellers, this is the answer.
          skipped += 1;
          continue;
        }

        await this.withdrawals.createAuto(seller.id, {
          currency: Currency.INR,
          amount: available.toFixed(2),
          note: 'Automatic daily withdrawal',
        });
        requested += 1;
      } catch (err) {
        // One seller's settings or limits must not stop the sweep for
        // everyone else — the same per-item isolation the manifest and
        // AWB fan-outs use.
        failures += 1;
        this.logger.warn(
          { sellerId: seller.id, err: err instanceof Error ? err.message : String(err) },
          'Auto-withdrawal skipped for this seller',
        );
      }
    }

    if (requested > 0 || failures > 0) {
      this.logger.log(
        { considered: sellers.length, requested, skipped, failures },
        'Auto-withdrawal sweep complete',
      );
    }
    return { considered: sellers.length, requested, skipped, failures };
  }

  /**
   * The hour it currently is where this seller lives.
   *
   * `Intl` rather than an offset table: offsets move (Dhaka has run DST
   * before) and hard-coding one is how a scheduled job silently drifts
   * an hour twice a year. An unknown zone falls back to UTC and is
   * logged rather than throwing — a typo in one seller's profile must
   * not stop everyone else's withdrawal.
   */
  private localHour(now: Date, timezone: string): number {
    try {
      const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      }).format(now);
      return Number(hour);
    } catch {
      this.logger.warn({ timezone }, 'Unknown seller timezone; treating as UTC');
      return now.getUTCHours();
    }
  }
}
