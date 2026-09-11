import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  CourierWalletTxnCategory,
  CourierWalletTxnKind,
  CourierWalletTxnLeg,
  CredentialEnvironment,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { LedgerFormatError, parseWalletLedger, type LedgerTxn } from './wallet-ledger-parser';

/**
 * How many written costs are listed by NAME on the result.
 *
 * The list travels inside an audit row's JSON, and `audit_logs` is one
 * of the largest tables we keep — an unbounded list would let a single
 * enormous import bloat it. A hundred is far above any real run here
 * (the busiest so far wrote sixteen) and small enough that the row
 * stays a row. Past it, the COUNT is still exact and
 * `writesTruncated` says how many were left out; the list is a
 * convenience, never the source of truth.
 */
const WRITE_DETAIL_CAP = 100;

/** Rows per insert. Large enough that 23,000 transactions is a handful
 *  of round trips, small enough to stay well under Postgres's parameter
 *  limit with fourteen columns apiece. */
const TXN_CHUNK = 500;
/** AWBs per grouped read, for the same reason. */
const AWB_CHUNK = 1000;

export interface WalletImportResult {
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  readonly awbsInFile: number;
  /**
   * Our parcels whose every stored transaction has vanished from their
   * ledger — their cost was cleared to unknown, since nothing supports
   * the old figure any more.
   */
  readonly costsCleared: number;
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
  /**
   * WHICH parcels this import wrote a cost against.
   *
   * The counts alone answer "did it work" and not "what did it do to my
   * orders", which is the question anybody actually has when a run says
   * it wrote sixteen. Carried on the result because the result is what
   * the audit row already records — no new table, and therefore no
   * second copy of a fact to drift.
   *
   * CAPPED (see WRITE_DETAIL_CAP): this ends up inside an audit row's
   * JSON, and an unbounded list would let one enormous import bloat the
   * largest table we keep. `writesTruncated` says how many were left
   * out rather than pretending the list is complete.
   */
  readonly writes: readonly WalletImportWrite[];
  readonly writesTruncated: number;
  /** Transactions this import added to our ledger. */
  readonly txnsNew: number;
  /** Transactions in the file we already held — the overlap a 90-day
   *  window re-reads every night, and the reason the window can be wide
   *  at no cost. */
  readonly txnsAlreadyHeld: number;
  /**
   * Transactions that came back CHANGED — a different amount, direction
   * or waybill than we recorded.
   *
   * Should always be zero: they correct a charge by adding a reversal,
   * not by editing history. A non-zero here means our copy and theirs
   * disagree about a past fact, and it is reported rather than applied.
   */
  readonly txnsMutated: number;
  /** The mutated transactions themselves, our copy against theirs (capped). */
  readonly mutated: readonly MutatedTxn[];
  /** Ledger-level entries in the file — reconciliations, settlements,
   *  credit notes. Not a parcel's cost; their own P&L line. */
  readonly adjustments: number;
  readonly adjustmentsNetInr: string;
  /** The file's own arithmetic: opening + recharges + refunds − deductions.
   *  Null when the Summary sheet is absent. */
  readonly impliedClosingInr: string | null;
  /**
   * Transactions WE hold, dated inside this export's span, that the
   * export no longer contains. Zero is normal; anything else means their
   * ledger changed its own history. Listed (capped) so the audit row
   * names them.
   */
  readonly txnsMissing: number;
  readonly missing: readonly MissingTxn[];
  /**
   * OUR parcels whose net came out NEGATIVE, and were therefore NOT
   * stamped.

   * Nobody is paid to carry a parcel, so a negative net only ever means
   * the ledger lacks one of its debits — its history started before we
   * held it, or a debit has since vanished. Stamping it would subtract
   * money from the P&L; leaving the old figure and saying so is honest.
   */
  readonly incompleteHistory: number;
  readonly incomplete: readonly IncompleteParcel[];
}

export interface WalletImportWrite {
  readonly awbNumber: string;
  /** Null when the parcel is not linked to an order — rare, but the
   *  shipment is the thing the courier charged for either way. */
  readonly orderNumber: string | null;
  readonly leg: 'forward' | 'rto';
  readonly amountInr: string;
  /** True when a figure already existed and MOVED. The normal case on a
   *  later export, and worth telling apart from a first reading. */
  readonly revised: boolean;
  /**
   * What it was BEFORE this import. Null on a first reading.
   *
   * The audit row used to record only the new figure, so a revision
   * overwrote its own evidence: on 2026-09-11 four parcels were about
   * to move from ₹77.19 to ₹75.95 with nothing anywhere saying they had
   * ever been ₹77.19. Before→after is what a dispute is argued from.
   */
  readonly previousInr: string | null;
}

/** A transaction whose amount, direction or waybill differs between our
 *  stored copy and the courier's latest export — history, edited. */
export interface MutatedTxn {
  readonly txnId: string;
  readonly awbNumber: string | null;
  readonly ourKind: string;
  readonly theirKind: string;
  readonly ourAmountInr: string;
  readonly theirAmountInr: string;
}

/** One of our parcels whose ledger nets below zero — see `incompleteHistory`. */
export interface IncompleteParcel {
  readonly awbNumber: string;
  readonly netInr: string;
}

/** A transaction a fresh export covering its date no longer contains. */
export interface MissingTxn {
  readonly txnId: string;
  readonly awbNumber: string | null;
  readonly kind: string;
  readonly amountInr: string;
  readonly occurredAt: string;
}

/** One courier account's wallet transactions, however they were read. */
export interface LedgerImport {
  readonly courierCode: string;
  readonly courierAccountId: string;
  readonly txns: readonly LedgerTxn[];
  /** The span the read actually covers — what "missing" is judged within. */
  readonly periodFrom: Date | null;
  readonly periodTo: Date | null;
  readonly rowsRead: number;
  readonly rowsSkipped: number;
  /** Σ debits read. */
  readonly sumInr: string;
  /** A total the SOURCE states for the same rows, when it states one. */
  readonly statedTotalInr: string | null;
  /** Whether the source's own integrity check held; null when it has none. */
  readonly totalsAgree: boolean | null;
  readonly impliedClosingInr: string | null;
  readonly dryRun: boolean;
  /** Null when the nightly sync ran it (see importDelhiveryWallet). */
  readonly staffId: string | null;
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

    const deductionsAgree =
      parsed.statedTotalInr === null
        ? null
        : Math.abs(Number(parsed.sumInr) - Number(parsed.statedTotalInr)) < 0.05;
    // Refunds are checked the same way. Only deductions used to be, so a
    // credit the parse dropped — a refund, a credit note, a courier
    // expense given back — went missing with the totals still "agreeing".
    const statedRefunds = parsed.statedRefundsInr ?? null;
    const refundsAgree =
      statedRefunds === null
        ? null
        : Math.abs(Number(parsed.refundsInr ?? '0') - Number(statedRefunds)) < 0.05;
    const totalsAgree =
      deductionsAgree === false || refundsAgree === false
        ? false
        : deductionsAgree === null && refundsAgree === null
          ? null
          : true;

    if (refundsAgree === false && opts.force !== true) {
      throw new BadRequestException({
        code: 'LEDGER_REFUNDS_DISAGREE',
        message:
          `The refund rows add up to ₹${parsed.refundsInr} but the file's own Summary says ` +
          `₹${statedRefunds}. A credit was mis-read or is missing, and a missing credit ` +
          `overstates what we spent. Re-download the export, or pass force if you know ` +
          `this is a partial file.`,
      });
    }

    if (deductionsAgree === false && opts.force !== true) {
      throw new BadRequestException({
        code: 'LEDGER_TOTALS_DISAGREE',
        message:
          `The rows add up to ₹${parsed.sumInr} but the file's own Summary says ` +
          `₹${parsed.statedTotalInr}. Something was mis-read, and importing a wrong ` +
          `cost is worse than importing none. Re-download the export, or pass force ` +
          `if you know this is a partial file.`,
      });
    }

    /*
      ── STEP 1: THE LEDGER, STORED ────────────────────────────────────

      Their txn id is the identity, unique per account, so this inserts
      what is new and leaves everything else alone. A transaction is a
      historical fact: once recorded it must never change, and a row
      that comes back with a DIFFERENT amount is not an update — it is
      either their bug or something worse, so it is COUNTED and reported
      rather than applied.
    */
    /*
      WHICH ACCOUNT THIS LEDGER IS.

      Required, and resolved rather than assumed. Every transaction is
      stored under an account, and the cost is then netted from what the
      TABLE holds — so an import with no account stored nothing and
      netted a ledger that did not contain the file, silently writing
      costs from whatever was already there. That was the manual
      upload's shape: the controller never passed one.

      The default active Delhivery account is used when the caller does
      not say, mirroring CourierAccountRoutingService's default lookup,
      and the import is REFUSED when there is none. Guessing would file
      one company's ledger under another's, and "not ours" would stop
      meaning anything on both.
    */
    const courierAccountId = opts.courierAccountId ?? (await this.defaultAccountId());

    /*
      ── THE FILE'S OWN ARITHMETIC ─────────────────────────────────────

      opening + recharges + refunds − deductions = the closing balance
      their wallet shows. Every row of the export is on one side of that
      identity, so a truncated or edited file breaks it — the strongest
      integrity check this file offers. Computed and reported rather than
      enforced: refusing an import over arithmetic would stop costs
      landing for a reason nobody can act on at 3am.
    */
    const summary = parsed.summary;
    const impliedClosingInr =
      summary.openingBalanceInr !== null &&
      summary.totalRechargesInr !== null &&
      summary.totalRefundsInr !== null &&
      summary.totalDeductionsInr !== null
        ? new Prisma.Decimal(summary.openingBalanceInr)
            .add(summary.totalRechargesInr)
            .add(summary.totalRefundsInr)
            .sub(summary.totalDeductionsInr)
            .toFixed(2)
        : null;

    return this.importTransactions({
      courierCode: 'delhivery',
      courierAccountId,
      txns: parsed.txns,
      periodFrom: parsed.periodFrom,
      periodTo: parsed.periodTo,
      rowsRead: parsed.rowsRead,
      rowsSkipped: parsed.rowsSkipped,
      sumInr: parsed.sumInr,
      statedTotalInr: parsed.statedTotalInr,
      totalsAgree,
      impliedClosingInr,
      dryRun,
      staffId,
    });
  }

  /**
   * Store, reconcile, net and stamp a courier's wallet transactions —
   * the whole of COST-1, for ANY courier whose wallet can be read as a
   * list of transactions.
   *
   * Delhivery's export arrives as a file (above); Shiprocket's passbook
   * is read off their panel. Both end here, so the rules are written once:
   * insert what is new and never rewrite what is held, report a changed
   * or vanished transaction instead of applying it, net each parcel from
   * OUR stored ledger rather than from the window just read, never stamp
   * a negative net, and record before→after on every cost that moves.
   *
   * The account and the courier both SCOPE it. A waybill is unique only
   * within a courier — an Xpressbees number routed through Shiprocket has
   * the same fourteen-digit shape as a Delhivery one — so netting across
   * accounts, or matching a shipment of another courier, would move
   * money between two parcels that merely share a number.
   */
  async importTransactions(input: LedgerImport): Promise<WalletImportResult> {
    const { courierAccountId, dryRun } = input;
    const stored = await this.storeTransactions(input.txns, courierAccountId, dryRun);
    // BEFORE netting, so a row their ledger has dropped stops counting in
    // the same run that notices it.
    const missing = await this.reconcileWindow(
      courierAccountId,
      input.txns,
      input.periodFrom,
      input.periodTo,
      dryRun,
    );

    const fileAwbs = new Set(
      input.txns.map((t) => t.awbNumber).filter((a): a is string => a !== null),
    );
    // A waybill a row VANISHED from is re-netted too, even when the file no
    // longer names it: its cost was netted with that row in it, and left
    // alone it would keep a figure our ledger no longer supports.
    const vanishedAwbs = new Set(
      missing.map((m) => m.awbNumber).filter((a): a is string => a !== null),
    );
    const awbs = new Set([...fileAwbs, ...vanishedAwbs]);
    const shipments = await this.prisma.client.shipment.findMany({
      where: {
        awbNumber: { in: [...awbs] },
        // The courier that carried it (CUR-14 rewrites this on failover).
        // A waybill is only unique within a courier.
        courierCode: input.courierCode,
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
        OR: [{ courierAccountId }, { courierAccountId: null }],
      },
      select: {
        id: true,
        awbNumber: true,
        actualCourierCostInr: true,
        actualRtoCostInr: true,
        courierAccountId: true,
        orderShipments: {
          orderBy: { shipmentSequence: 'asc' },
          take: 1,
          select: { order: { select: { orderNumber: true } } },
        },
      },
    });
    const byAwb = new Map(shipments.map((s) => [s.awbNumber ?? '', s]));

    /*
      ── STEP 2: THE COST, NETTED FROM OUR OWN LEDGER ──────────────────

      `Σ debits − Σ credits` per PARCEL, read back from the TABLE rather
      than computed from this file.

      That distinction is the whole point of storing them. The nightly
      export is a WINDOW: a parcel charged in June and credited today
      appears in today's file with the credit alone, and netting the
      file would report its cost as NEGATIVE the refund. Netting our own
      ledger — which holds both — gives the truth.

      PER PARCEL, NOT PER LEG. When a parcel turns around, Delhivery
      refunds the delivery charge and bills ONE combined return charge,
      and BOTH rows carry the shipment status "RTO". On the 90-day sample
      891 of 921 return-leg credits were exactly a forward debit being
      given back. Netted per leg, that refund landed on the return leg:
      301 parcels came out with a NEGATIVE return cost, and 38061110524086
      read ₹73.51 back against a real ₹151.91 — while the P&L, which
      counts only the return column for a returned parcel, reported the
      smaller number. So a parcel with ANY return-leg transaction carries
      its whole net on the RETURN column and ₹0 forward (the delivery
      charge was refunded), and every other parcel carries it forward.
      The two columns then always ADD UP to what the parcel cost.

      ADJUSTMENTS are excluded here even when they name an AWB. A
      monthly reconciliation or a fraud credit note is an account-level
      cost, and 36 of the 37 on the 90-day sample carried a waybill, so
      including them would put a settlement for fraud into the price of
      moving one box.
    */
    const netByAwb = dryRun
      ? this.netFromFile(input.txns)
      : await this.netFromLedger(courierAccountId, [...awbs]);

    let forwardWritten = 0;
    let rtoWritten = 0;
    let unchanged = 0;
    let revised = 0;
    const writes: WalletImportWrite[] = [];
    let writesTruncated = 0;

    const apply = async (
      awbNumber: string,
      leg: 'forward' | 'rto',
      next: Prisma.Decimal,
      chargedAt: Date,
    ): Promise<void> => {
      const ship = byAwb.get(awbNumber);
      if (ship === undefined) return;
      const current = leg === 'forward' ? ship.actualCourierCostInr : ship.actualRtoCostInr;
      if (current !== null && current.equals(next)) {
        unchanged += 1;
        return;
      }
      const wasRevised = current !== null;
      if (wasRevised) revised += 1;
      if (leg === 'forward') forwardWritten += 1;
      else rtoWritten += 1;

      // Recorded BEFORE the dry-run return: a dry run's whole purpose is
      // to show what it WOULD change, and a list that emptied itself in
      // the mode meant for previewing would be useless exactly where it
      // is most wanted.
      if (writes.length < WRITE_DETAIL_CAP) {
        writes.push({
          awbNumber,
          orderNumber: ship.orderShipments[0]?.order.orderNumber ?? null,
          leg,
          amountInr: next.toString(),
          revised: wasRevised,
          previousInr: current === null ? null : current.toString(),
        });
      } else {
        writesTruncated += 1;
      }

      if (dryRun) return;

      // Repair the attribution while we are here: the ledger this was
      // read from IS the account that carried it.
      const attribute = ship.courierAccountId === null ? { courierAccountId } : {};
      await this.prisma.client.shipment.update({
        where: { id: ship.id },
        data:
          leg === 'forward'
            ? { actualCourierCostInr: next, actualCourierCostAt: chargedAt, ...attribute }
            : { actualRtoCostInr: next, actualRtoCostAt: chargedAt, ...attribute },
      });
    };

    const incomplete: IncompleteParcel[] = [];
    for (const [awbNumber, net] of netByAwb) {
      if (net.total.isNegative()) {
        // Only OURS are worth naming: somebody else's parcel is not
        // written either way, and 298 of them on the 90-day sample began
        // before the window.
        if (byAwb.has(awbNumber)) {
          incomplete.push({ awbNumber, netInr: net.total.toFixed(2) });
        }
        continue;
      }
      if (net.returned) {
        await apply(awbNumber, 'forward', new Prisma.Decimal(0), net.latestAt);
        await apply(awbNumber, 'rto', net.total, net.latestAt);
      } else {
        await apply(awbNumber, 'forward', net.total, net.latestAt);
      }
    }

    // A parcel whose EVERY stored transaction has since vanished from
    // their ledger has no net left at all, so the loop above never reaches
    // it — and its old cost stood, a figure nothing supports any more. It
    // is CLEARED to unknown (null, never ₹0: nobody knows what it cost),
    // which puts it back on its line as uncovered rather than as priced.
    let costsCleared = 0;
    for (const awbNumber of vanishedAwbs) {
      if (netByAwb.has(awbNumber)) continue;
      const ship = byAwb.get(awbNumber);
      if (ship === undefined) continue;
      if (ship.actualCourierCostInr === null && ship.actualRtoCostInr === null) continue;
      costsCleared += 1;
      if (dryRun) continue;
      await this.prisma.client.shipment.update({
        where: { id: ship.id },
        data: { actualCourierCostInr: null, actualRtoCostInr: null },
      });
    }

    // Ledger-level entries, kept apart from every parcel. Netted the
    // same way: a debit costs us, a credit gives back.
    const adjustmentTxns = input.txns.filter((t) => t.category === 'ADJUSTMENT');
    let adjustmentsNet = new Prisma.Decimal(0);
    for (const t of adjustmentTxns) {
      adjustmentsNet =
        t.kind === 'DEBIT' ? adjustmentsNet.add(t.amountInr) : adjustmentsNet.sub(t.amountInr);
    }

    const unknownAwbs = [...fileAwbs].filter((a) => !byAwb.has(a)).length;

    const result: WalletImportResult = {
      rowsRead: input.rowsRead,
      rowsSkipped: input.rowsSkipped,
      awbsInFile: fileAwbs.size,
      costsCleared,
      forwardWritten,
      rtoWritten,
      unchanged,
      revised,
      unknownAwbs,
      sumInr: input.sumInr,
      statedTotalInr: input.statedTotalInr,
      totalsAgree: input.totalsAgree,
      periodFrom: input.periodFrom?.toISOString() ?? null,
      periodTo: input.periodTo?.toISOString() ?? null,
      dryRun,
      writes,
      writesTruncated,
      txnsNew: stored.created,
      txnsAlreadyHeld: stored.existing,
      txnsMutated: stored.mutated.length,
      mutated: stored.mutated.slice(0, WRITE_DETAIL_CAP),
      adjustments: adjustmentTxns.length,
      adjustmentsNetInr: adjustmentsNet.toFixed(2),
      impliedClosingInr: input.impliedClosingInr,
      txnsMissing: missing.length,
      missing: missing.slice(0, WRITE_DETAIL_CAP),
      incompleteHistory: incomplete.length,
      incomplete: incomplete.slice(0, WRITE_DETAIL_CAP),
    };

    if (!dryRun) {
      await this.audit.log({
        actorType: input.staffId === null ? ActorType.SYSTEM : ActorType.STAFF,
        actorId: input.staffId,
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
        metadata: { courierCode: input.courierCode, ...result },
      });
    }
    this.logger.log(
      { courierCode: input.courierCode, ...result },
      'Courier wallet ledger imported',
    );
    return result;
  }

  /**
   * A transaction we hold that a fresh export covering its date omits.
   *
   * Mutation detection compares a transaction against ITSELF, so it
   * cannot see one that is simply gone — and on 2026-09-11 that is what
   * happened: four debits dated 7 Sep were in that night's export and
   * absent from a 90-day export covering the same day.
   *
   * Only the span the file actually covers is judged: from its earliest
   * row to its latest. A row dated outside that is not "missing", the
   * file just does not reach it. The row is KEPT — it is the evidence —
   * and stamped; the stamp is cleared if the transaction reappears, so a
   * transient omission corrects itself instead of haunting the ledger.
   */
  private async reconcileWindow(
    courierAccountId: string,
    txns: readonly LedgerTxn[],
    from: Date | null,
    to: Date | null,
    dryRun: boolean,
  ): Promise<MissingTxn[]> {
    if (from === null || to === null) return [];
    const inFile = new Set(txns.map((t) => t.txnId));
    const held = await this.prisma.client.courierWalletTransaction.findMany({
      where: { courierAccountId, occurredAt: { gte: from, lte: to } },
      select: {
        id: true,
        txnId: true,
        awbNumber: true,
        kind: true,
        amountInr: true,
        occurredAt: true,
        missingFromExportAt: true,
      },
    });

    const missing = held.filter((h) => !inFile.has(h.txnId));
    const returned = held.filter((h) => inFile.has(h.txnId) && h.missingFromExportAt !== null);

    if (!dryRun) {
      const newly = missing.filter((h) => h.missingFromExportAt === null).map((h) => h.id);
      if (newly.length > 0) {
        await this.prisma.client.courierWalletTransaction.updateMany({
          where: { id: { in: newly } },
          data: { missingFromExportAt: new Date() },
        });
      }
      if (returned.length > 0) {
        await this.prisma.client.courierWalletTransaction.updateMany({
          where: { id: { in: returned.map((h) => h.id) } },
          data: { missingFromExportAt: null },
        });
      }
    }

    return missing.map((h) => ({
      txnId: h.txnId,
      awbNumber: h.awbNumber,
      kind: h.kind,
      amountInr: h.amountInr.toString(),
      occurredAt: h.occurredAt.toISOString(),
    }));
  }

  /** The default active production Delhivery account — the same lookup
   *  CourierAccountRoutingService falls back to. Refuses rather than
   *  guessing when there is none. */
  private async defaultAccountId(): Promise<string> {
    const acct = await this.prisma.client.courierAccount.findFirst({
      where: {
        courier: { code: 'delhivery' },
        environment: CredentialEnvironment.PRODUCTION,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (acct === null) {
      throw new BadRequestException({
        code: 'NO_DEFAULT_COURIER_ACCOUNT',
        message:
          'No default active Delhivery account to file this ledger under. Say which account ' +
          'the export belongs to, or mark one as the default on /courier-accounts.',
      });
    }
    return acct.id;
  }

  /**
   * Insert what is new; never rewrite what is there.
   *
   * Their txn id is unique per account, so a re-import of an overlapping
   * window is a no-op for everything already held. `createMany` with
   * `skipDuplicates` does that in one round trip per chunk rather than
   * 23,276 of them.
   *
   * The MUTATION CHECK is separate and deliberate: a transaction whose
   * amount, direction or waybill has changed since we recorded it is
   * not a correction to apply, it is a statement that our copy and
   * theirs disagree about a past fact. Delhivery corrects a charge by
   * adding a reversal, not by editing history, so this should never
   * fire — which is exactly why it is worth watching.
   */
  private async storeTransactions(
    txns: readonly LedgerTxn[],
    courierAccountId: string,
    dryRun: boolean,
  ): Promise<{ created: number; existing: number; mutated: MutatedTxn[] }> {
    if (txns.length === 0) return { created: 0, existing: 0, mutated: [] };

    const byId = new Map(txns.map((t) => [t.txnId, t]));
    const held = await this.prisma.client.courierWalletTransaction.findMany({
      where: { courierAccountId, txnId: { in: [...byId.keys()] } },
      select: { txnId: true, amountInr: true, kind: true, awbNumber: true },
    });

    const mutated: MutatedTxn[] = [];
    for (const h of held) {
      const t = byId.get(h.txnId);
      if (t === undefined) continue;
      const changed =
        !h.amountInr.equals(new Prisma.Decimal(t.amountInr)) ||
        h.kind !== t.kind ||
        (h.awbNumber ?? null) !== t.awbNumber;
      if (changed) {
        mutated.push({
          txnId: t.txnId,
          awbNumber: t.awbNumber,
          ourKind: h.kind,
          theirKind: t.kind,
          ourAmountInr: h.amountInr.toString(),
          theirAmountInr: t.amountInr,
        });
      }
    }

    const fresh = txns.filter((t) => !held.some((h) => h.txnId === t.txnId));
    if (!dryRun && fresh.length > 0) {
      for (let i = 0; i < fresh.length; i += TXN_CHUNK) {
        await this.prisma.client.courierWalletTransaction.createMany({
          data: fresh.slice(i, i + TXN_CHUNK).map((t) => ({
            courierAccountId,
            txnId: t.txnId,
            awbNumber: t.awbNumber,
            kind: t.kind,
            category: t.category,
            leg: t.leg,
            amountInr: new Prisma.Decimal(t.amountInr),
            occurredAt: t.occurredAt,
            status: t.status,
            shipmentStatus: t.shipmentStatus,
            ...(t.detail === null ? {} : { detail: t.detail as Prisma.InputJsonValue }),
          })),
          // Belt to the unique index's braces: two imports racing on the
          // same window must not fail, they must agree.
          skipDuplicates: true,
        });
      }
    }
    return { created: fresh.length, existing: held.length, mutated };
  }

  /**
   * `Σ debits − Σ credits` per parcel, from OUR ledger, and whether the
   * parcel came back (any return-leg transaction).
   *
   * Grouped in the database rather than loaded and summed here: the
   * table holds every transaction ever seen, and a parcel's history can
   * span months even though each file covers ninety days.
   *
   * Only PARCEL rows. An adjustment is an account-level cost and has
   * its own report line (see the P&L); letting one through here would
   * put a fraud settlement into the price of moving one box.
   */
  private async netFromLedger(
    courierAccountId: string,
    awbs: readonly string[],
  ): Promise<Map<string, ParcelNet>> {
    const out = new Map<string, ParcelNet>();
    if (awbs.length === 0) return out;

    for (let i = 0; i < awbs.length; i += AWB_CHUNK) {
      const rows = await this.prisma.client.courierWalletTransaction.groupBy({
        by: ['awbNumber', 'leg', 'kind'],
        where: {
          // One account's ledger: a waybill is unique only within a courier.
          courierAccountId,
          awbNumber: { in: awbs.slice(i, i + AWB_CHUNK) },
          category: CourierWalletTxnCategory.PARCEL,
          // A row their ledger has since dropped no longer moves money:
          // the later export still balances to the live wallet without it.
          missingFromExportAt: null,
        },
        _sum: { amountInr: true },
        _max: { occurredAt: true },
      });
      for (const r of rows) {
        if (r.awbNumber === null) continue;
        fold(out, r.awbNumber, {
          debit: r.kind === CourierWalletTxnKind.DEBIT,
          returnLeg: r.leg === CourierWalletTxnLeg.RTO,
          amount: r._sum.amountInr ?? new Prisma.Decimal(0),
          at: r._max.occurredAt,
        });
      }
    }
    return out;
  }

  /** The same arithmetic over the FILE, for a dry run — which must not
   *  read back rows it has deliberately not written. */
  private netFromFile(txns: readonly LedgerTxn[]): Map<string, ParcelNet> {
    const out = new Map<string, ParcelNet>();
    for (const t of txns) {
      if (t.awbNumber === null || t.category !== 'PARCEL') continue;
      fold(out, t.awbNumber, {
        debit: t.kind === 'DEBIT',
        returnLeg: t.leg === 'RTO',
        amount: new Prisma.Decimal(t.amountInr),
        at: t.occurredAt,
      });
    }
    return out;
  }
}

/** A parcel's whole net, whether it came back, and its latest charge. */
interface ParcelNet {
  total: Prisma.Decimal;
  returned: boolean;
  latestAt: Date;
}

function fold(
  out: Map<string, ParcelNet>,
  awb: string,
  row: { debit: boolean; returnLeg: boolean; amount: Prisma.Decimal; at: Date | null },
): void {
  const held = out.get(awb) ?? {
    total: new Prisma.Decimal(0),
    returned: false,
    latestAt: new Date(0),
  };
  held.total = row.debit ? held.total.add(row.amount) : held.total.sub(row.amount);
  if (row.returnLeg) held.returned = true;
  if (row.at !== null && row.at > held.latestAt) held.latestAt = row.at;
  out.set(awb, held);
}
