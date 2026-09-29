import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import type { NdrAction } from '../../courier-delhivery/services/delhivery-ndr.service';
import {
  NARROW_TO_NOTHING,
  narrowNdrGate,
  parseNdrActions,
  type NdrGate,
  type NdrSellerNarrowing,
} from './ndr-gate';

const KEYS = {
  enabled: 'courier.ndr_runner_enabled',
  runnerCron: 'courier.ndr_runner_cron',
  autoCategories: 'courier.ndr_auto_categories',
  batchMax: 'courier.ndr_batch_max',
  pollCron: 'courier.ndr_upl_poll_cron',
  pollDeadlineMinutes: 'courier.ndr_upl_poll_deadline_minutes',
  reconcileCron: 'courier.ndr_reconciliation_cron',
  reconcileWindowHours: 'courier.ndr_reconciliation_window_hours',
  reconcileAlertPercent: 'courier.ndr_reconciliation_alert_percent',
  alertEmail: 'ops.alert_email',
} as const;

/**
 * Reads for the NDR runner's settings, in one place.
 *
 * Every default here FAILS CLOSED: a missing, malformed or unreadable
 * row produces the safe answer, not the permissive one. That matters
 * more than usual because these settings gate calls that send vans — a
 * settings outage must degrade into doing nothing, never into doing
 * everything.
 *
 * ── GLOBAL VS PER SELLER ─────────────────────────────────────────────
 * Two of these keys — the kill switch and the auto-action allow list —
 * are seller-overridable (SET-1), and a seller's override may only ever
 * NARROW what the global pair permits. `globalGate()` reads the ceiling;
 * `gateForSeller()` reads the seller's opinion and hands both to
 * `narrowNdrGate`, which is the ONE place the two are combined. Nothing
 * else in the codebase may resolve these keys — in particular not
 * through `SettingsResolverService.resolve()`'s ordinary
 * `sellerOverride ?? systemDefault` result, which is exactly the shape
 * that would let one seller row switch the runner back on. See
 * `ndr-gate.ts` for the argument.
 *
 * The rest stay GLOBAL on purpose: a cron line, a batch cap, the UPL
 * poll and the reconciliation window are all properties of ONE nightly
 * sweep on ONE schedule, and a per-seller version of any of them would
 * be a value with nowhere to apply.
 */
@Injectable()
export class NdrSettingsService {
  private readonly logger = new Logger(NdrSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    /**
     * SET-1's resolver. Named `settings` so the per-seller read reads as
     * `this.settings.resolve(...)` — the shape
     * `seller-setting-overrides-are-honoured.spec.ts` scans for, and the
     * reason an overridable key here is provably consumed per seller.
     */
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * The kill switch, GLOBALLY. Absent or unreadable ⇒ OFF.
   *
   * PRIVATE, with `autoActions` below, so nothing outside this file can
   * read a global switch and act on it as if it were the answer for a
   * parcel. `globalGate()` and `gateForSeller()` are the surface, and
   * the second is the one a parcel is judged by.
   */
  private async runnerEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: KEYS.enabled },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  /**
   * Which actions may be fired unattended, GLOBALLY — the CEILING every
   * seller's list is intersected with.
   */
  private async autoActions(): Promise<NdrAction[]> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: KEYS.autoCategories },
      select: { valueJson: true },
    });
    return parseNdrActions(row?.valueJson);
  }

  /** The global pair, read together because they are decided together. */
  async globalGate(): Promise<NdrGate> {
    const [enabled, autoActions] = await Promise.all([this.runnerEnabled(), this.autoActions()]);
    return { enabled, autoActions };
  }

  /**
   * What this seller's parcels are permitted, given the global ceiling.
   *
   * The global gate is passed in rather than re-read so one nightly
   * sweep asks the database for it once — and, more importantly, so
   * every seller in a run is judged against the SAME ceiling. Re-reading
   * per seller would let an operator flipping the switch mid-sweep
   * produce a run that was half live and half not, with the summary
   * unable to say which half.
   */
  async gateForSeller(sellerId: string, global: NdrGate): Promise<NdrGate> {
    return narrowNdrGate(global, await this.sellerNarrowing(sellerId));
  }

  /**
   * The seller's own opinion, or nothing.
   *
   * Only a value the seller ACTUALLY set is returned (`source ===
   * 'SELLER_OVERRIDE'`); the resolver's fallback to the system default
   * is deliberately discarded, because handing the global value back as
   * if the seller had chosen it would make the narrowing a no-op that
   * looked like it worked.
   *
   * FAILS CLOSED: an unreadable setting narrows this seller to nothing.
   * The asymmetry is the point — not firing a van we meant to fire costs
   * a day; firing one we did not costs money, a customer's afternoon and
   * a courier call.
   */
  private async sellerNarrowing(sellerId: string): Promise<NdrSellerNarrowing> {
    try {
      const [enabled, actions] = await Promise.all([
        this.settings.resolve(sellerId, KEYS.enabled),
        this.settings.resolve(sellerId, KEYS.autoCategories),
      ]);
      return {
        // `=== true` rather than a cast: an override holding anything
        // other than a real `true` narrows the seller off.
        enabled: enabled.source === 'SELLER_OVERRIDE' ? enabled.value === true : null,
        autoActions: actions.source === 'SELLER_OVERRIDE' ? parseNdrActions(actions.value) : null,
      };
    } catch (err) {
      this.logger.warn(
        { sellerId, err: err instanceof Error ? err.message : String(err) },
        'NDR per-seller settings read failed; this seller is narrowed to nothing for this run',
      );
      return NARROW_TO_NOTHING;
    }
  }

  async batchMax(): Promise<number> {
    return this.int(KEYS.batchMax, 50);
  }

  async pollDeadlineMinutes(): Promise<number> {
    return this.int(KEYS.pollDeadlineMinutes, 240);
  }

  async reconcileWindowHours(): Promise<number> {
    return this.int(KEYS.reconcileWindowHours, 48);
  }

  async reconcileAlertPercent(): Promise<number> {
    return this.int(KEYS.reconcileAlertPercent, 25);
  }

  /** Empty string when unset — the caller decides what that means. */
  async alertEmail(): Promise<string> {
    return this.str(KEYS.alertEmail, '');
  }

  async runnerCron(): Promise<string> {
    return this.str(KEYS.runnerCron, '35 21 * * *');
  }

  async pollCron(): Promise<string> {
    return this.str(KEYS.pollCron, '*/20 * * * *');
  }

  async reconcileCron(): Promise<string> {
    return this.str(KEYS.reconcileCron, '0 12 * * *');
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }

  private async str(key: string, fallback: string): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueString: true },
    });
    const v = (row?.valueString ?? '').trim();
    return v === '' ? fallback : v;
  }
}
