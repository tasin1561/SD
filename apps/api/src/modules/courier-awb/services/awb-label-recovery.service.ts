import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { AwbGenerationService, type LabelOnlyOutcome } from './awb-generation.service';
import { CourierAwbDispatchService } from './courier-awb-dispatch.service';
import { EnvService } from '../../../config/env.service';

/**
 * PRE_DISPATCH — parcels still in the building (status CREATED), where a
 * missing label stops the pack bench. ALL — every live waybill, including
 * parcels already with the courier, for a one-off backfill.
 */
export type LabelRecoveryScope = 'PRE_DISPATCH' | 'ALL';

export interface MissingLabel {
  shipmentId: string;
  shipmentNumber: string;
  awbNumber: string;
  courierCode: string;
  status: ShipmentStatus;
  /** When the saga stamped the waybill; null when it arrived some other
   *  way (a seeding script, a hand edit). */
  awbGeneratedAt: Date | null;
  createdAt: Date;
  orderId: string | null;
  orderNumber: string | null;
}

export interface LabelRecoveryResult {
  missing: MissingLabel;
  outcome: LabelOnlyOutcome;
}

export interface LabelRecoveryRun {
  results: LabelRecoveryResult[];
  /** The query returned fewer rows than its limit, so every candidate was
   *  looked at. Judged on the RAW row count, never on what survived a
   *  filter in code. */
  sawEverything: boolean;
}

export interface LabelBackfillReport {
  dryRun: boolean;
  scope: LabelRecoveryScope;
  considered: number;
  stored: number;
  pending: number;
  skipped: number;
  rows: Array<{
    shipmentId: string;
    shipmentNumber: string;
    awbNumber: string;
    courierCode: string;
    shipmentStatus: ShipmentStatus;
    result: 'WOULD_FETCH' | LabelOnlyOutcome['status'];
    detail: string | null;
  }>;
}

/**
 * CUR-6 — a waybill with no stored label, found and fixed.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────
 * The label leg runs once, inside the AWB job. If it fails, BullMQ
 * retries the job three times over about twenty seconds, then files ONE
 * generic "AwbGenerationWorker gave up on a job" issue (deduped per
 * worker, so a second parcel's failure only bumps a counter) — and
 * nothing ever asks for that label again. A waybill that arrives any
 * other way (the tracking-test seeding script writes shipments straight
 * at DISPATCHED) never had a label leg to fail.
 *
 * ── WHAT IT MAY TOUCH ───────────────────────────────────────────────
 * A label fetch is a READ from the courier: it books nothing, moves no
 * parcel, and CUR-10 is not engaged. Every call still goes through the
 * dispatcher (CUR-12) and so through the courier's own rate limiter, and
 * every row goes through `AwbGenerationService.persistLabelForExistingAwb`,
 * which refuses a shipment with no waybill rather than booking one.
 */
@Injectable()
export class AwbLabelRecoveryService {
  private readonly logger = new Logger(AwbLabelRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly generation: AwbGenerationService,
    private readonly dispatch: CourierAwbDispatchService,
    private readonly env: EnvService,
  ) {}

  /**
   * Couriers whose label leg would actually run: they have an adapter
   * (CUR-6 — a manual courier has no label), and in production they are
   * not stubbed (`persistLabelForExistingAwb` skips COURIER_STUBBED).
   * Filtering these IN THE QUERY is what keeps a permanently-skipped row
   * from holding the oldest slot of every page forever.
   */
  private async fetchableCourierCodes(): Promise<string[]> {
    const codes: string[] = [];
    for (const code of this.dispatch.adapterCourierCodes()) {
      if (this.env.isProduction && (await this.dispatch.isStubMode(code))) continue;
      codes.push(code);
    }
    return codes;
  }

  /** Live waybills with no current label, oldest first. */
  async findMissing(opts: {
    scope: LabelRecoveryScope;
    limit: number;
    /** Leave alone anything whose waybill is younger than this — the AWB
     *  job may still be retrying its own label leg. */
    olderThan?: Date;
  }): Promise<MissingLabel[]> {
    return (await this.findMissingPage(opts)).rows;
  }

  private async findMissingPage(opts: {
    scope: LabelRecoveryScope;
    limit: number;
    olderThan?: Date;
  }): Promise<{ rows: MissingLabel[]; sawEverything: boolean }> {
    const where: Prisma.ShipmentWhereInput = {
      awbNumber: { not: null },
      isManualCourier: false,
      courierCode: { in: await this.fetchableCourierCodes() },
      deletedAt: null,
      supersededAt: null,
      awbLabels: { none: { isCurrent: true } },
      ...(opts.scope === 'PRE_DISPATCH' ? { status: ShipmentStatus.CREATED } : {}),
      ...(opts.olderThan === undefined
        ? {}
        : {
            OR: [
              { awbGeneratedAt: { lt: opts.olderThan } },
              { awbGeneratedAt: null, createdAt: { lt: opts.olderThan } },
            ],
          }),
    };
    const rows = await this.prisma.client.shipment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: opts.limit,
      select: {
        id: true,
        shipmentNumber: true,
        awbNumber: true,
        courierCode: true,
        status: true,
        awbGeneratedAt: true,
        createdAt: true,
        orderShipments: {
          take: 1,
          select: { order: { select: { id: true, orderNumber: true } } },
        },
      },
    });
    const out: MissingLabel[] = [];
    for (const r of rows) {
      // Defensive only — the query already asked for exactly these.
      if (r.awbNumber === null || !this.dispatch.hasAdapter(r.courierCode)) continue;
      const order = r.orderShipments[0]?.order ?? null;
      out.push({
        shipmentId: r.id,
        shipmentNumber: r.shipmentNumber,
        awbNumber: r.awbNumber,
        courierCode: r.courierCode,
        status: r.status,
        awbGeneratedAt: r.awbGeneratedAt,
        createdAt: r.createdAt,
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? null,
      });
    }
    return { rows: out, sawEverything: rows.length < opts.limit };
  }

  /**
   * Fetch and store each missing label, one at a time. Per-shipment
   * isolation: one courier error never costs the rest their labels.
   */
  async retryMissing(opts: {
    scope: LabelRecoveryScope;
    limit: number;
    olderThan?: Date;
    actor?: { type: ActorType; id?: string | null };
  }): Promise<LabelRecoveryRun> {
    const actor = opts.actor ?? { type: ActorType.SYSTEM };
    const { rows: missing, sawEverything } = await this.findMissingPage(opts);
    const results: LabelRecoveryResult[] = [];
    for (const m of missing) {
      let outcome: LabelOnlyOutcome;
      try {
        outcome = await this.generation.persistLabelForExistingAwb(m.shipmentId, actor);
      } catch (err) {
        outcome = {
          status: 'PENDING',
          shipmentId: m.shipmentId,
          awbNumber: m.awbNumber,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
      results.push({ missing: m, outcome });
    }
    return { results, sawEverything };
  }

  /**
   * The operator backfill. A DRY RUN (the default) lists what it would
   * fetch and calls nobody. A real run fetches, stores and audits.
   */
  async backfill(opts: {
    scope: LabelRecoveryScope;
    limit: number;
    dryRun: boolean;
    staffId: string;
  }): Promise<LabelBackfillReport> {
    const report: LabelBackfillReport = {
      dryRun: opts.dryRun,
      scope: opts.scope,
      considered: 0,
      stored: 0,
      pending: 0,
      skipped: 0,
      rows: [],
    };

    if (opts.dryRun) {
      const missing = await this.findMissing({ scope: opts.scope, limit: opts.limit });
      report.considered = missing.length;
      report.rows = missing.map((m) => ({
        shipmentId: m.shipmentId,
        shipmentNumber: m.shipmentNumber,
        awbNumber: m.awbNumber,
        courierCode: m.courierCode,
        shipmentStatus: m.status,
        result: 'WOULD_FETCH',
        detail: null,
      }));
      return report;
    }

    const { results } = await this.retryMissing({
      scope: opts.scope,
      limit: opts.limit,
      actor: { type: ActorType.STAFF, id: opts.staffId },
    });
    report.considered = results.length;
    for (const { missing: m, outcome } of results) {
      if (outcome.status === 'STORED') report.stored += 1;
      else if (outcome.status === 'PENDING') report.pending += 1;
      else report.skipped += 1;
      report.rows.push({
        shipmentId: m.shipmentId,
        shipmentNumber: m.shipmentNumber,
        awbNumber: m.awbNumber,
        courierCode: m.courierCode,
        shipmentStatus: m.status,
        result: outcome.status,
        detail:
          outcome.status === 'STORED'
            ? outcome.labelSpacesKey
            : outcome.status === 'PENDING'
              ? outcome.errorMessage
              : outcome.reason,
      });
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: opts.staffId,
      action: 'awb.label_backfill_run',
      entityType: 'shipment',
      // Not about one row (rule 6: entity_id is a UUID or null).
      entityId: null,
      severity: 'MEDIUM',
      metadata: {
        scope: opts.scope,
        limit: opts.limit,
        considered: report.considered,
        stored: report.stored,
        pending: report.pending,
        skipped: report.skipped,
      },
    });
    this.logger.log(
      { scope: opts.scope, stored: report.stored, pending: report.pending },
      'AWB label backfill ran',
    );
    return report;
  }
}
