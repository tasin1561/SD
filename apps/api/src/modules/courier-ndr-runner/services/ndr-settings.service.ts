import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { NdrAction } from '../../courier-delhivery/services/delhivery-ndr.service';

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

/** Delhivery's own vocabulary — the only two actions the API accepts. */
const KNOWN_ACTIONS: readonly NdrAction[] = ['RE-ATTEMPT', 'PICKUP_RESCHEDULE'];

/**
 * Reads for the NDR runner's settings, in one place.
 *
 * Every default here FAILS CLOSED: a missing, malformed or unreadable
 * row produces the safe answer, not the permissive one. That matters
 * more than usual because these settings gate calls that send vans — a
 * settings outage must degrade into doing nothing, never into doing
 * everything.
 */
@Injectable()
export class NdrSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The kill switch. Absent or unreadable ⇒ OFF. */
  async runnerEnabled(): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: KEYS.enabled },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }

  /**
   * Which actions may be fired unattended. Anything unrecognised is
   * DROPPED rather than trusted: this list is edited by hand in an admin
   * form, and a typo must not become an action nobody reviewed.
   */
  async autoActions(): Promise<NdrAction[]> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: KEYS.autoCategories },
      select: { valueJson: true },
    });
    const raw = row?.valueJson;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (v): v is NdrAction =>
        typeof v === 'string' && (KNOWN_ACTIONS as readonly string[]).includes(v),
    );
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
