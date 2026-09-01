import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { LedgerFormatError, parseWalletLedger, type LedgerCharge } from './wallet-ledger-parser';

export interface WalletImportResult {
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  readonly awbsInFile: number;
  /** Shipments whose forward cost we wrote or changed. */
  readonly forwardWritten: number;
  readonly rtoWritten: number;
  /** Already carried this exact figure — a re-import of the same file. */
  readonly unchanged: number;
  /** Costs that MOVED, which is the normal case on a later export. */
  readonly revised: number;
  /** In the file, not ours. Somebody else's parcels, or ours before we
   *  recorded the AWB. Reported, never an error. */
  readonly unknownAwbs: number;
  readonly sumInr: string;
  readonly statedTotalInr: string | null;
  readonly totalsAgree: boolean | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly dryRun: boolean;
}

/**
 * What Delhivery actually charged us, read off their wallet export.
 *
 * ── WHY A FILE AND NOT AN API ────────────────────────────────────────
 * They have no billing API. Their whole documented B2C surface offers
 * one cost endpoint and it is a CALCULATOR — origin, destination,
 * weight, mode — which cannot answer "what was this parcel billed", only
 * "what does a parcel of this shape cost". It also cannot see a
 * revision, and revisions are the point: a charge is re-cut weeks after
 * delivery. The wallet ledger is the only record of what really left.
 *
 * ── RE-RUNNABLE BY DESIGN, AND IT MUST BE ────────────────────────────
 * Importing is not a one-off. A cost that looked settled last month
 * moves when a weight is rechecked, so this OVERWRITES what it wrote
 * before rather than skipping AWBs it has seen. `revised` counts those,
 * because a number quietly changing is worth seeing.
 *
 * ── THE FILE CHECKS ITSELF ───────────────────────────────────────────
 * The Summary sheet states the period's total deductions. We sum what we
 * parsed and compare. A mismatch means the parse dropped or double-read
 * rows, and since the failure would otherwise be silent money in the
 * P&L, it REFUSES rather than writing a partial answer. `force` exists
 * for the case where an operator knows the file is a partial export.
 */
@Injectable()
export class WalletImportService {
  private readonly logger = new Logger(WalletImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async importDelhiveryWallet(
    file: Buffer,
    /** NULL when the nightly sync ran it — nobody did, the schedule did.
     *  `audit_logs.actor_id` is a UUID column, so a label like
     *  "system:wallet-sync" would make Postgres reject the insert and
     *  AuditLogService would swallow it: the row simply would not
     *  exist. `actorType` already says SYSTEM. */
    staffId: string | null,
    opts: {
      dryRun?: boolean;
      force?: boolean;
      /**
       * Match only shipments booked on THIS account.
       *
       * Each Delhivery account is its own company with its own wallet,
       * so its ledger describes its own parcels. Without the scope every
       * account's import would report the others' AWBs as "not ours",
       * and the count that is supposed to mean "a parcel we never
       * recorded" would mean nothing. Omitted for the manual upload,
       * where the operator picked the file and knows what it is.
       */
      courierAccountId?: string;
    } = {},
  ): Promise<WalletImportResult> {
    const dryRun = opts.dryRun === true;
    let parsed;
    try {
      parsed = parseWalletLedger(file);
    } catch (err) {
      if (err instanceof LedgerFormatError) {
        throw new BadRequestException({ code: 'LEDGER_UNREADABLE', message: err.message });
      }
      throw err;
    }

    const totalsAgree =
      parsed.statedTotalInr === null
        ? null
        : Math.abs(Number(parsed.sumInr) - Number(parsed.statedTotalInr)) < 0.05;

    if (totalsAgree === false && opts.force !== true) {
      throw new BadRequestException({
        code: 'LEDGER_TOTALS_DISAGREE',
        message:
          `The rows add up to ₹${parsed.sumInr} but the file's own Summary says ` +
          `₹${parsed.statedTotalInr}. Something was mis-read, and importing a wrong ` +
          `cost is worse than importing none. Re-download the export, or pass force ` +
          `if you know this is a partial file.`,
      });
    }

    const awbs = new Set([...parsed.forward.keys(), ...parsed.rto.keys()]);
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        awbNumber: { in: [...awbs] },
        // This account's parcels — OR ones with no account recorded.
        //
        // An AWB is globally unique at Delhivery, so a waybill in THIS
        // account's ledger belongs to this account whatever our row
        // says. Ten of eleven live shipments carried no account id at
        // all (booked before the account row existed), and a strict
        // scope silently excluded every one: 1,123 AWBs read, nothing
        // matched, and the import looked like it had worked.
        //
        // The unattributed ones are matched too and the account is
        // BACKFILLED below — the courier's own ledger is the authority
        // on whose account carried a parcel, which is what CACC-1 wants
        // recorded.
        ...(opts.courierAccountId === undefined
          ? {}
          : { OR: [{ courierAccountId: opts.courierAccountId }, { courierAccountId: null }] }),
      },
      select: {
        id: true,
        awbNumber: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        courierAccountId: true,
      },
    });
    const byAwb = new Map(shipments.map((s) => [s.awbNumber ?? '', s]));

    let forwardWritten = 0;
    let rtoWritten = 0;
    let unchanged = 0;
    let revised = 0;

    const apply = async (charge: LedgerCharge, leg: 'forward' | 'rto'): Promise<void> => {
      const ship = byAwb.get(charge.awbNumber);
      if (ship === undefined) return;
      const current = leg === 'forward' ? ship.actualCourierCostInr : ship.actualRtoCostInr;
      const next = new Prisma.Decimal(charge.amountInr);
      if (current !== null && current.equals(next)) {
        unchanged += 1;
        return;
      }
      if (current !== null) revised += 1;
      if (leg === 'forward') forwardWritten += 1;
      else rtoWritten += 1;
      if (dryRun) return;

      // Repair the attribution while we are here: the ledger this was
      // read from IS the account that carried it.
      const attribute =
        opts.courierAccountId !== undefined && ship.courierAccountId === null
          ? { courierAccountId: opts.courierAccountId }
          : {};
      await this.prisma.client.shipment.update({
        where: { id: ship.id },
        data:
          leg === 'forward'
            ? { actualCourierCostInr: next, actualCourierCostAt: charge.chargedAt, ...attribute }
            : { actualRtoCostInr: next, actualRtoCostAt: charge.chargedAt, ...attribute },
      });
    };

    for (const charge of parsed.forward.values()) await apply(charge, 'forward');
    for (const charge of parsed.rto.values()) await apply(charge, 'rto');

    const unknownAwbs = [...awbs].filter((a) => !byAwb.has(a)).length;

    const result: WalletImportResult = {
      rowsRead: parsed.rowsRead,
      rowsSkipped: parsed.rowsSkipped,
      awbsInFile: awbs.size,
      forwardWritten,
      rtoWritten,
      unchanged,
      revised,
      unknownAwbs,
      sumInr: parsed.sumInr,
      statedTotalInr: parsed.statedTotalInr,
      totalsAgree,
      periodFrom: parsed.periodFrom?.toISOString() ?? null,
      periodTo: parsed.periodTo?.toISOString() ?? null,
      dryRun,
    };

    if (!dryRun) {
      await this.audit.log({
        actorType: staffId === null ? ActorType.SYSTEM : ActorType.STAFF,
        actorId: staffId,
        action: 'courier.wallet_ledger.imported',
        entityType: 'courier',
        // NULL, not 'delhivery'. `audit_logs.entity_id` is a UUID
        // column, so a courier code makes Postgres reject the insert —
        // and AuditLogService swallows its own failures by design, so
        // the row would simply never have existed. The code goes in
        // metadata, where it is readable.
        entityId: null,
        // MEDIUM: it writes the cost side of the P&L, and a revision
        // changes a figure somebody may already have reported on.
        severity: 'MEDIUM',
        metadata: { courierCode: 'delhivery', ...result },
      });
    }
    this.logger.log({ ...result }, 'Delhivery wallet ledger imported');
    return result;
  }
}
