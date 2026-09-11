import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketHttpService } from '../../courier-shiprocket/services/shiprocket-http.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { amount, readingFromOrder } from './shiprocket-cost-reading';

export const ACTION_SHIPROCKET_COST_OK = 'courier.shiprocket_cost.synced';
export const ACTION_SHIPROCKET_COST_FAILED = 'courier.shiprocket_cost.sync_failed';
export const SETTING_SR_COST_ENABLED = 'courier.shiprocket_cost_sync_enabled';
export const SETTING_SR_COST_WRITES = 'courier.shiprocket_cost_sync_writes_enabled';

/** How far back parcels are re-read. Their billing is finalised late —
 *  weeks after delivery — and a weight dispute can move it later still. */
const LOOKBACK_DAYS = 180;
/** Written parcels listed by name on the run, as the Delhivery run does. */
const WRITE_DETAIL_CAP = 100;

export interface ShiprocketCostWrite {
  readonly awbNumber: string;
  readonly orderNumber: string | null;
  readonly leg: 'forward' | 'rto';
  readonly amountInr: string;
  readonly revised: boolean;
  readonly previousInr: string | null;
}

export interface ShiprocketCostAccountResult {
  readonly label: string;
  readonly courierAccountId: string;
  readonly error: string | null;
  readonly balanceInr: string | null;
  readonly previousBalanceInr: string | null;
  /** Balance now minus the last snapshot. */
  readonly balanceChangeInr: string | null;
  /** How much our own parcels' charges moved since their last reading. */
  readonly parcelChargeChangeInr: string;
  /**
   * The part of the balance change our parcels do not explain: other
   * parcels on the account, recharges, credits and disputes. REPORTED,
   * never booked as an expense — without their ledger we cannot say
   * which it was.
   */
  readonly unexplainedInr: string | null;
  readonly parcelsRead: number;
  readonly readingsStored: number;
  readonly unreadable: number;
  readonly failed: number;
  readonly finalCount: number;
  readonly provisionalOnly: number;
  readonly forwardWritten: number;
  readonly rtoWritten: number;
  readonly revised: number;
  readonly unchanged: number;
  readonly dryRun: boolean;
  readonly writes: readonly ShiprocketCostWrite[];
  readonly writesTruncated: number;
}

export interface ShiprocketCostRun {
  readonly skipped: 'DISABLED' | 'STUB_MODE' | 'NO_ACCOUNTS' | null;
  readonly wrote: boolean;
  readonly accounts: readonly ShiprocketCostAccountResult[];
}

/**
 * What Shiprocket charged for our parcels, read nightly from their API.
 *
 * ── THE SAME RULES AS DELHIVERY, FROM A DIFFERENT SOURCE ─────────────
 * Only Shiprocket's FINAL `billing_amount` is ever stamped as a parcel's
 * cost, and it is stamped the way COST-1 stamps a returned parcel: its
 * whole cost on the return column and ₹0 forward, so the two columns add
 * up to what it cost and every P&L line reads them added (TRE-6). The
 * provisional figure is kept on each reading and shown, never stamped.
 *
 * ── EACH PARCEL ALONE ────────────────────────────────────────────────
 * One order that will not load must not cost the rest their reading —
 * the same per-item isolation as the AWB saga. It is counted and the
 * run carries on.
 *
 * ── THE WALLET ───────────────────────────────────────────────────────
 * Their balance is snapshotted into the same table as Delhivery's. The
 * movement our parcels do not explain is reported as unexplained: the
 * account also carries parcels booked on their website, plus recharges
 * and credits, and without their ledger none of that can be attributed.
 * Reporting it is honest; calling it a courier expense would not be.
 */
@Injectable()
export class ShiprocketCostSyncService {
  private readonly logger = new Logger(ShiprocketCostSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ShiprocketHttpService,
    private readonly audit: AuditLogService,
    private readonly issues: SystemIssueService,
  ) {}

  async sync(trigger: 'SCHEDULE' | 'MANUAL'): Promise<ShiprocketCostRun> {
    const runId = `${Date.now()}`;
    let result: ShiprocketCostRun;
    try {
      result = await this.run(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        actorId: null,
        action: ACTION_SHIPROCKET_COST_FAILED,
        entityType: 'courier',
        // A uuid column; the courier code goes in metadata.
        entityId: null,
        severity: 'HIGH',
        metadata: { courierCode: 'shiprocket', trigger, error: message.slice(0, 500) },
      });
      throw err;
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      action: ACTION_SHIPROCKET_COST_OK,
      entityType: 'courier',
      entityId: null,
      severity: 'MEDIUM',
      metadata: {
        courierCode: 'shiprocket',
        trigger,
        skipped: result.skipped,
        wrote: result.wrote,
        accounts: result.accounts.map((a) => ({ ...a })),
      },
    });
    return result;
  }

  private async run(runId: string): Promise<ShiprocketCostRun> {
    const [enabled, writes] = await Promise.all([
      this.flag(SETTING_SR_COST_ENABLED),
      this.flag(SETTING_SR_COST_WRITES),
    ]);
    if (!enabled) return { skipped: 'DISABLED', wrote: false, accounts: [] };
    if (await this.http.isStubMode()) return { skipped: 'STUB_MODE', wrote: false, accounts: [] };

    const accounts = await this.prisma.client.courierAccount.findMany({
      where: {
        courier: { code: 'shiprocket' },
        isActive: true,
        deletedAt: null,
        credentialId: { not: null },
      },
      select: { id: true, label: true },
      orderBy: { createdAt: 'asc' },
    });
    if (accounts.length === 0) return { skipped: 'NO_ACCOUNTS', wrote: false, accounts: [] };

    const results: ShiprocketCostAccountResult[] = [];
    for (const account of accounts) {
      try {
        results.push(await this.syncAccount(account, writes, runId));
        await this.issues.resolveByKey(
          `shiprocket-cost-sync:${account.id}`,
          'The Shiprocket cost sync completed on its own.',
        );
      } catch (err) {
        // One account failing must not stop the others.
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { err: message, courierAccountId: account.id },
          'Shiprocket cost sync failed',
        );
        await this.issues.raise({
          kind: SystemIssueKind.COURIER_COST_SYNC,
          severity: SystemIssueSeverity.HIGH,
          title: `Shiprocket cost sync failed for ${account.label}`,
          detail:
            `Reading Shiprocket's charges failed: ${message.slice(0, 300)}. Their costs stop ` +
            'updating until this works again; the parcels read as uncovered in the P&L, not as free.',
          source: 'ShiprocketCostSyncService',
          dedupeKey: `shiprocket-cost-sync:${account.id}`,
          metadata: { courierAccountId: account.id, label: account.label },
        });
        results.push(this.failedResult(account, message, writes));
      }
    }
    return { skipped: null, wrote: writes, accounts: results };
  }

  private async syncAccount(
    account: { id: string; label: string },
    writes: boolean,
    runId: string,
  ): Promise<ShiprocketCostAccountResult> {
    const actor = courierActor.runner('shiprocket-cost-sync', runId);

    // ── The wallet ───────────────────────────────────────────────────
    const wallet = await this.http.request<{ data?: { balance_amount?: unknown } }>({
      method: 'GET',
      path: '/v1/external/account/details/wallet-balance',
      actor,
      courierAccountId: account.id,
    });
    const balance = amount(wallet.data?.balance_amount);
    const previous = await this.prisma.client.courierWalletBalance.findFirst({
      where: { courierAccountId: account.id },
      orderBy: { capturedAt: 'desc' },
      select: { balanceInr: true },
    });
    if (balance !== null) {
      // A fact about their wallet, not a cost — recorded whether or not
      // cost writes are switched on.
      await this.prisma.client.courierWalletBalance.create({
        data: { courierAccountId: account.id, balanceInr: new Prisma.Decimal(balance.toFixed(2)) },
      });
    }

    // ── Our parcels ──────────────────────────────────────────────────
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        courierCode: 'shiprocket',
        courierAccountId: account.id,
        courierOrderId: { not: null },
        deletedAt: null,
        createdAt: { gte: since },
      },
      select: {
        id: true,
        awbNumber: true,
        courierOrderId: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
          select: { order: { select: { orderNumber: true } } },
        },
      },
    });

    let readingsStored = 0;
    let unreadable = 0;
    let failed = 0;
    let finalCount = 0;
    let provisionalOnly = 0;
    let forwardWritten = 0;
    let rtoWritten = 0;
    let revised = 0;
    let unchanged = 0;
    let chargeChangePaise = 0;
    const writesList: ShiprocketCostWrite[] = [];
    let writesTruncated = 0;

    for (const s of shipments) {
      const courierOrderId = s.courierOrderId ?? '';
      let reading;
      try {
        const body = await this.http.request<{ data?: unknown }>({
          method: 'GET',
          path: `/v1/external/orders/show/${encodeURIComponent(courierOrderId)}`,
          actor,
          courierAccountId: account.id,
        });
        reading = readingFromOrder(body.data);
      } catch (err) {
        failed += 1;
        this.logger.warn(
          { shipmentId: s.id, err: err instanceof Error ? err.message : String(err) },
          'Shiprocket order would not load; carrying on with the rest',
        );
        continue;
      }
      if (reading === null) {
        unreadable += 1;
        continue;
      }

      const last = await this.prisma.client.courierCostReading.findFirst({
        where: { shipmentId: s.id },
        orderBy: { readAt: 'desc' },
        select: { fingerprint: true, provisionalInr: true },
      });
      if (last === null || last.fingerprint !== reading.fingerprint) {
        await this.prisma.client.courierCostReading.create({
          data: {
            courierAccountId: account.id,
            shipmentId: s.id,
            courierCode: 'shiprocket',
            courierOrderId,
            awbNumber: reading.awbNumber ?? s.awbNumber,
            theirStatus: reading.theirStatus,
            billedInr: reading.billedInr,
            provisionalInr: reading.provisionalInr,
            forwardInr: reading.forwardInr,
            codChargeInr: reading.codChargeInr,
            rtoInr: reading.rtoInr,
            appliedWeightKg: reading.appliedWeightKg,
            chargedWeightKg: reading.chargedWeightKg,
            returned: reading.returned,
            fingerprint: reading.fingerprint,
          },
        });
        readingsStored += 1;
        const was =
          last?.provisionalInr === null || last === null
            ? 0
            : Math.round(Number(last.provisionalInr) * 100);
        const now =
          reading.provisionalInr === null ? 0 : Math.round(Number(reading.provisionalInr) * 100);
        chargeChangePaise += now - was;
      }

      if (reading.billedInr === null) {
        provisionalOnly += 1;
        continue;
      }
      finalCount += 1;

      // Their final figure, stamped the COST-1 way: a returned parcel's
      // whole cost on the return column and ₹0 forward.
      const billed = new Prisma.Decimal(reading.billedInr);
      const targets: Array<{ leg: 'forward' | 'rto'; next: Prisma.Decimal }> = reading.returned
        ? [
            { leg: 'forward', next: new Prisma.Decimal(0) },
            { leg: 'rto', next: billed },
          ]
        : [{ leg: 'forward', next: billed }];

      for (const t of targets) {
        const current = t.leg === 'forward' ? s.actualCourierCostInr : s.actualRtoCostInr;
        if (current !== null && current.equals(t.next)) {
          unchanged += 1;
          continue;
        }
        const wasRevised = current !== null;
        if (wasRevised) revised += 1;
        if (t.leg === 'forward') forwardWritten += 1;
        else rtoWritten += 1;
        if (writesList.length < WRITE_DETAIL_CAP) {
          writesList.push({
            awbNumber: reading.awbNumber ?? s.awbNumber ?? courierOrderId,
            orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
            leg: t.leg,
            amountInr: t.next.toString(),
            revised: wasRevised,
            previousInr: current === null ? null : current.toString(),
          });
        } else {
          writesTruncated += 1;
        }
        if (!writes) continue;
        const at = new Date();
        await this.prisma.client.shipment.update({
          where: { id: s.id },
          data:
            t.leg === 'forward'
              ? { actualCourierCostInr: t.next, actualCourierCostAt: at }
              : { actualRtoCostInr: t.next, actualRtoCostAt: at },
        });
      }
    }

    const prevBal = previous === null ? null : Number(previous.balanceInr);
    const balanceChange =
      balance === null || prevBal === null ? null : Math.round((balance - prevBal) * 100);
    return {
      label: account.label,
      courierAccountId: account.id,
      error: null,
      balanceInr: balance === null ? null : balance.toFixed(2),
      previousBalanceInr: prevBal === null ? null : prevBal.toFixed(2),
      balanceChangeInr: balanceChange === null ? null : (balanceChange / 100).toFixed(2),
      parcelChargeChangeInr: (chargeChangePaise / 100).toFixed(2),
      // Charges rising pull the balance DOWN, so a movement fully explained
      // by our parcels nets to zero here.
      unexplainedInr:
        balanceChange === null ? null : ((balanceChange + chargeChangePaise) / 100).toFixed(2),
      parcelsRead: shipments.length,
      readingsStored,
      unreadable,
      failed,
      finalCount,
      provisionalOnly,
      forwardWritten,
      rtoWritten,
      revised,
      unchanged,
      dryRun: !writes,
      writes: writesList,
      writesTruncated,
    };
  }

  private failedResult(
    account: { id: string; label: string },
    message: string,
    writes: boolean,
  ): ShiprocketCostAccountResult {
    return {
      label: account.label,
      courierAccountId: account.id,
      error: message.slice(0, 500),
      balanceInr: null,
      previousBalanceInr: null,
      balanceChangeInr: null,
      parcelChargeChangeInr: '0.00',
      unexplainedInr: null,
      parcelsRead: 0,
      readingsStored: 0,
      unreadable: 0,
      failed: 0,
      finalCount: 0,
      provisionalOnly: 0,
      forwardWritten: 0,
      rtoWritten: 0,
      revised: 0,
      unchanged: 0,
      dryRun: !writes,
      writes: [],
      writesTruncated: 0,
    };
  }

  private async flag(key: string): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean === true;
  }
}
