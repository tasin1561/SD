import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ShiprocketHttpService } from '../../courier-shiprocket/services/shiprocket-http.service';
import {
  ACTION_SHIPROCKET_COST_FAILED,
  ACTION_SHIPROCKET_COST_OK,
  SETTING_SR_COST_ENABLED,
  type ShiprocketCostAccountResult,
} from './shiprocket-cost-sync.service';

/** Restated: the wallet sync (portal worker) is the only writer of a cost. */
const SETTING_SR_WALLET_WRITES = 'courier.shiprocket_wallet_sync_writes_enabled';

export interface ShiprocketCostRunView {
  readonly at: string;
  readonly ok: boolean;
  readonly trigger: string | null;
  readonly skipped: string | null;
  readonly error: string | null;
  readonly accounts: readonly ShiprocketCostAccountResult[];
}

export interface ShiprocketParcelCostView {
  readonly shipmentId: string;
  readonly orderNumber: string | null;
  readonly awbNumber: string | null;
  readonly theirStatus: string;
  readonly provisionalInr: string | null;
  readonly billedInr: string | null;
  readonly recordedForwardInr: string | null;
  readonly recordedRtoInr: string | null;
  readonly readAt: string;
  /** How many distinct readings this parcel has had — >1 means it moved. */
  readonly readings: number;
}

/** The portal worker's last look at the panel. Restated here, not
 *  imported: the API must not reach into the portal module. */
export interface ShiprocketPortalProbeView {
  readonly at: string;
  readonly accounts: ReadonlyArray<{
    readonly courierAccountId: string;
    readonly label: string;
    readonly outcome: string;
    readonly detail: string | null;
    readonly artifactDir: string | null;
    readonly pages: ReadonlyArray<{ readonly tab: string; readonly landedOnLogin: boolean }>;
  }>;
}

/**
 * The portal worker's nightly wallet sync, from its audit rows. The action
 * names are RESTATED from `ShiprocketWalletSyncService` — the API must not
 * import the portal module — and `shiprocket-portal.spec.ts` pins them.
 */
export const ACTION_SR_WALLET_OK = 'courier.shiprocket_wallet.synced';
export const ACTION_SR_WALLET_FAILED = 'courier.shiprocket_wallet.sync_failed';

export interface ShiprocketWalletRunView {
  readonly at: string;
  readonly ok: boolean;
  readonly trigger: string | null;
  readonly skipped: string | null;
  readonly wrote: boolean;
  readonly windowDays: number | null;
  /** Per account, as the worker recorded it (outcome, counts, ledger check). */
  readonly accounts: ReadonlyArray<Record<string, unknown>>;
}

/**
 * The portal worker's nightly invoice check, from its audit rows — names
 * restated from `ShiprocketInvoiceCheckService`, pinned by the same spec.
 */
export const ACTION_SR_INVOICES_OK = 'courier.shiprocket_invoices.checked';
export const ACTION_SR_INVOICES_FAILED = 'courier.shiprocket_invoices.check_failed';

export interface ShiprocketInvoiceRunView {
  readonly at: string;
  readonly ok: boolean;
  readonly trigger: string | null;
  readonly skipped: string | null;
  readonly windowDays: number | null;
  /** Per account, as the worker recorded it: each invoice's result and the uninvoiced totals. */
  readonly accounts: ReadonlyArray<Record<string, unknown>>;
}

export interface ShiprocketCostPanel {
  readonly enabled: boolean;
  readonly writesEnabled: boolean;
  readonly stubMode: boolean;
  readonly schedule: string;
  readonly balances: ReadonlyArray<{
    readonly courierAccountId: string;
    readonly label: string;
    readonly balanceInr: string;
    readonly capturedAt: string;
  }>;
  readonly last: ShiprocketCostRunView | null;
  readonly history: readonly ShiprocketCostRunView[];
  readonly parcels: readonly ShiprocketParcelCostView[];
  readonly portalProbe: ShiprocketPortalProbeView | null;
  /** The nightly wallet sync: newest first. */
  readonly walletSyncs: readonly ShiprocketWalletRunView[];
  /** The nightly invoice check: newest first. */
  readonly invoiceChecks: readonly ShiprocketInvoiceRunView[];
}

/** What the /cost-sync page shows for Shiprocket. Reads only. */
@Injectable()
export class ShiprocketCostPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: ShiprocketHttpService,
  ) {}

  async panel(limit = 20): Promise<ShiprocketCostPanel> {
    const [settings, stubMode, runs, accounts] = await Promise.all([
      this.prisma.client.systemSetting.findMany({
        where: { key: { in: [SETTING_SR_COST_ENABLED, SETTING_SR_WALLET_WRITES] } },
        select: { key: true, valueBoolean: true },
      }),
      this.http.isStubMode(),
      this.prisma.client.auditLog.findMany({
        where: { action: { in: [ACTION_SHIPROCKET_COST_OK, ACTION_SHIPROCKET_COST_FAILED] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { action: true, createdAt: true, metadata: true },
      }),
      this.prisma.client.courierAccount.findMany({
        where: { courier: { code: 'shiprocket' }, deletedAt: null },
        select: { id: true, label: true },
      }),
    ]);
    const flag = (k: string): boolean => settings.find((s) => s.key === k)?.valueBoolean === true;

    const balances = [];
    for (const a of accounts) {
      const b = await this.prisma.client.courierWalletBalance.findFirst({
        where: { courierAccountId: a.id },
        orderBy: { capturedAt: 'desc' },
        select: { balanceInr: true, capturedAt: true },
      });
      if (b !== null) {
        balances.push({
          courierAccountId: a.id,
          label: a.label,
          balanceInr: b.balanceInr.toFixed(2),
          capturedAt: b.capturedAt.toISOString(),
        });
      }
    }

    const history = runs.map((r) => toRun(r.action, r.createdAt, r.metadata));

    // Every Shiprocket parcel of ours with its LATEST reading.
    const shipments = await this.prisma.client.shipment.findMany({
      where: { courierCode: 'shiprocket', deletedAt: null, costReadings: { some: {} } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        awbNumber: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        orderShipments: { take: 1, select: { order: { select: { orderNumber: true } } } },
        costReadings: {
          orderBy: { readAt: 'desc' },
          take: 1,
          select: { theirStatus: true, provisionalInr: true, billedInr: true, readAt: true },
        },
        _count: { select: { costReadings: true } },
      },
    });
    const parcels: ShiprocketParcelCostView[] = [];
    for (const s of shipments) {
      const r = s.costReadings[0];
      if (r === undefined) continue;
      parcels.push({
        shipmentId: s.id,
        orderNumber: s.orderShipments[0]?.order.orderNumber ?? null,
        awbNumber: s.awbNumber,
        theirStatus: r.theirStatus,
        provisionalInr: r.provisionalInr?.toFixed(2) ?? null,
        billedInr: r.billedInr?.toFixed(2) ?? null,
        recordedForwardInr: s.actualCourierCostInr?.toFixed(2) ?? null,
        recordedRtoInr: s.actualRtoCostInr?.toFixed(2) ?? null,
        readAt: r.readAt.toISOString(),
        readings: s._count.costReadings,
      });
    }

    const probeRow = await this.prisma.client.auditLog.findFirst({
      where: { action: 'courier.shiprocket_portal.probed' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    });
    const pm = (probeRow?.metadata ?? {}) as Record<string, unknown>;
    const portalProbe: ShiprocketPortalProbeView | null =
      probeRow === null
        ? null
        : {
            at: probeRow.createdAt.toISOString(),
            accounts: Array.isArray(pm['accounts'])
              ? (pm['accounts'] as ShiprocketPortalProbeView['accounts'])
              : [],
          };

    const walletRows = await this.prisma.client.auditLog.findMany({
      where: { action: { in: [ACTION_SR_WALLET_OK, ACTION_SR_WALLET_FAILED] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { action: true, createdAt: true, metadata: true },
    });
    const walletSyncs: ShiprocketWalletRunView[] = walletRows.map((r) => {
      const m = (r.metadata !== null && typeof r.metadata === 'object' ? r.metadata : {}) as Record<
        string,
        unknown
      >;
      return {
        at: r.createdAt.toISOString(),
        ok: r.action === ACTION_SR_WALLET_OK,
        trigger: typeof m['trigger'] === 'string' ? m['trigger'] : null,
        skipped: typeof m['skipped'] === 'string' ? m['skipped'] : null,
        wrote: m['wrote'] === true,
        windowDays: typeof m['windowDays'] === 'number' ? m['windowDays'] : null,
        accounts: Array.isArray(m['accounts'])
          ? (m['accounts'] as Array<Record<string, unknown>>)
          : [],
      };
    });

    const invoiceRows = await this.prisma.client.auditLog.findMany({
      where: { action: { in: [ACTION_SR_INVOICES_OK, ACTION_SR_INVOICES_FAILED] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { action: true, createdAt: true, metadata: true },
    });
    const invoiceChecks: ShiprocketInvoiceRunView[] = invoiceRows.map((r) => {
      const m = (r.metadata !== null && typeof r.metadata === 'object' ? r.metadata : {}) as Record<
        string,
        unknown
      >;
      return {
        at: r.createdAt.toISOString(),
        ok: r.action === ACTION_SR_INVOICES_OK,
        trigger: typeof m['trigger'] === 'string' ? m['trigger'] : null,
        skipped: typeof m['skipped'] === 'string' ? m['skipped'] : null,
        windowDays: typeof m['windowDays'] === 'number' ? m['windowDays'] : null,
        accounts: Array.isArray(m['accounts'])
          ? (m['accounts'] as Array<Record<string, unknown>>)
          : [],
      };
    });

    return {
      walletSyncs,
      invoiceChecks,
      portalProbe,
      enabled: flag(SETTING_SR_COST_ENABLED),
      writesEnabled: flag(SETTING_SR_WALLET_WRITES),
      stubMode,
      schedule: 'Every night at 21:40 IST',
      balances,
      last: history[0] ?? null,
      history,
      parcels,
    };
  }
}

/** The audit metadata is JSON; a row that does not parse is an empty run
 *  rather than an error — one bad record must not take out the page. */
function toRun(action: string, at: Date, raw: unknown): ShiprocketCostRunView {
  const m = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    at: at.toISOString(),
    ok: action === ACTION_SHIPROCKET_COST_OK,
    trigger: typeof m['trigger'] === 'string' ? m['trigger'] : null,
    skipped: typeof m['skipped'] === 'string' ? m['skipped'] : null,
    error: typeof m['error'] === 'string' ? m['error'] : null,
    accounts: Array.isArray(m['accounts']) ? (m['accounts'] as ShiprocketCostAccountResult[]) : [],
  };
}
