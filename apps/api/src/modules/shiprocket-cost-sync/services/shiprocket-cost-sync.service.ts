import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  CourierWalletTxnCategory,
  CourierWalletTxnKind,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { ShiprocketHttpService } from '../../courier-shiprocket/services/shiprocket-http.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { amount, readingFromOrder } from './shiprocket-cost-reading';

export const ACTION_SHIPROCKET_COST_OK = 'courier.shiprocket_cost.synced';
export const ACTION_SHIPROCKET_COST_FAILED = 'courier.shiprocket_cost.sync_failed';
export const SETTING_SR_COST_ENABLED = 'courier.shiprocket_cost_sync_enabled';

/** How far back parcels are re-read. Their billing is finalised late —
 *  weeks after delivery — and a weight dispute can move it later still. */
const LOOKBACK_DAYS = 180;
/** Written parcels listed by name on the run, as the Delhivery run does. */
const WRITE_DETAIL_CAP = 100;

/** A final bill that disagrees with what the passbook ledger recorded. */
export interface ShiprocketBillCheck {
  readonly awbNumber: string;
  readonly orderNumber: string | null;
  /** Their final `billing_amount`. */
  readonly billedInr: string;
  /** Forward + return, as the wallet ledger costed the parcel. */
  readonly ledgerInr: string;
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
  /** Final bills that equal the cost the passbook ledger recorded. */
  readonly ledgerAgrees: number;
  /** Final bills that DIFFER from it — each one named below. */
  readonly ledgerDisagrees: number;
  /** Final bills for a parcel the ledger has not costed yet. */
  readonly ledgerUncovered: number;
  readonly disagreements: readonly ShiprocketBillCheck[];
}

export interface ShiprocketCostRun {
  readonly skipped: 'DISABLED' | 'STUB_MODE' | 'NO_ACCOUNTS' | null;
  readonly accounts: readonly ShiprocketCostAccountResult[];
}

/**
 * What Shiprocket charged for our parcels, read nightly from their API.
 *
 * ── IT CHECKS; IT DOES NOT WRITE ─────────────────────────────────────
 * A parcel's cost has ONE writer: the wallet ledger — their passbook, read
 * nightly by the portal worker and netted the COST-1 way. This reads each
 * order's FINAL `billing_amount`, their own figure, and compares it with
 * what the ledger recorded, naming any parcel where the two disagree. It
 * used to write that figure itself; two writers would take turns
 * overwriting each other and record a "revision" every night. The
 * provisional figure is kept on each reading and shown, never booked.
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
        accounts: result.accounts.map((a) => ({ ...a })),
      },
    });
    return result;
  }

  private async run(runId: string): Promise<ShiprocketCostRun> {
    const enabled = await this.flag(SETTING_SR_COST_ENABLED);
    if (!enabled) return { skipped: 'DISABLED', accounts: [] };
    if (await this.http.isStubMode()) return { skipped: 'STUB_MODE', accounts: [] };

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
    if (accounts.length === 0) return { skipped: 'NO_ACCOUNTS', accounts: [] };

    const results: ShiprocketCostAccountResult[] = [];
    for (const account of accounts) {
      try {
        results.push(await this.syncAccount(account, runId));
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
        results.push(this.failedResult(account, message));
      }
    }
    return { skipped: null, accounts: results };
  }

  private async syncAccount(
    account: { id: string; label: string },
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
    let ledgerAgrees = 0;
    let ledgerDisagrees = 0;
    let ledgerUncovered = 0;
    let chargeChangePaise = 0;
    const disagreements: ShiprocketBillCheck[] = [];

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

      // Their final figure is CHECKED against the passbook ledger — never
      // written. One cost per parcel, from one writer.
      //
      // Against the FREIGHT part of the ledger only. `billing_amount` is
      // their freight bill; the per-order extras the wallet also charged
      // (WhatsApp messages, RTO-risk scoring, Delivery Boost) are billed on
      // their separate VAS invoices. The parcel's recorded cost rightly
      // includes those — it is what the parcel cost us — but comparing the
      // bill with it would flag every parcel by ₹10.02 the day they bill.
      const billed = new Prisma.Decimal(reading.billedInr);
      const recorded = await this.ledgerFreightInr(account.id, reading.awbNumber ?? s.awbNumber);
      if (recorded === null) {
        ledgerUncovered += 1;
        continue;
      }
      if (recorded.equals(billed)) {
        ledgerAgrees += 1;
        continue;
      }
      ledgerDisagrees += 1;
      if (disagreements.length < WRITE_DETAIL_CAP) {
        disagreements.push({
          awbNumber: reading.awbNumber ?? s.awbNumber ?? courierOrderId,
          orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
          billedInr: billed.toFixed(2),
          ledgerInr: recorded.toFixed(2),
        });
      }
    }

    /*
      THEIR BILL AND THEIR WALLET DISAGREE.

      Their final figure should equal the net of what their wallet
      charged for the parcel. When it does not, one of the two is wrong
      and it is money either way — so it is named, not averaged. The
      ledger's figure stands in the P&L: it is what actually left.
    */
    const checkKey = `shiprocket-bill-vs-ledger:${account.id}`;
    if (ledgerDisagrees > 0) {
      await this.issues.raise({
        kind: SystemIssueKind.MONEY,
        severity: SystemIssueSeverity.MEDIUM,
        title: `${ledgerDisagrees} Shiprocket final bill(s) disagree with the wallet ledger`,
        detail:
          'Shiprocket billed these parcels a different total from what their own wallet ' +
          'charged us for them. The wallet figure is what the P&L uses.\n\n' +
          disagreements
            .slice(0, 10)
            .map(
              (d) =>
                `${d.awbNumber} · ${d.orderNumber ?? '—'} · billed ₹${d.billedInr}, wallet ₹${d.ledgerInr}`,
            )
            .join('\n'),
        source: 'ShiprocketCostSyncService',
        dedupeKey: checkKey,
        metadata: {
          courierAccountId: account.id,
          disagreements: disagreements.slice(0, 25).map((d) => ({ ...d })),
        },
      });
    } else {
      await this.issues.resolveByKey(checkKey, 'Every final bill matches the wallet ledger again.');
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
      ledgerAgrees,
      ledgerDisagrees,
      ledgerUncovered,
      disagreements,
    };
  }

  /**
   * Σ freight debits − Σ freight credits the wallet ledger holds for one
   * parcel on one account; null when it holds none yet (not costed).
   */
  private async ledgerFreightInr(
    courierAccountId: string,
    awbNumber: string | null,
  ): Promise<Prisma.Decimal | null> {
    if (awbNumber === null) return null;
    const rows = await this.prisma.client.courierWalletTransaction.groupBy({
      by: ['kind'],
      where: {
        courierAccountId,
        awbNumber,
        category: CourierWalletTxnCategory.PARCEL,
        missingFromExportAt: null,
        detail: { path: ['transactionType'], equals: 'Freight Charges' },
      },
      _sum: { amountInr: true },
    });
    if (rows.length === 0) return null;
    let net = new Prisma.Decimal(0);
    for (const r of rows) {
      const amount = r._sum.amountInr ?? new Prisma.Decimal(0);
      net = r.kind === CourierWalletTxnKind.DEBIT ? net.add(amount) : net.sub(amount);
    }
    return net;
  }

  private failedResult(
    account: { id: string; label: string },
    message: string,
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
      ledgerAgrees: 0,
      ledgerDisagrees: 0,
      ledgerUncovered: 0,
      disagreements: [],
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
