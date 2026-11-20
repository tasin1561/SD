import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SystemIssueService } from './system-issue.service';

/** Where the duplicate happened. Only used to word the incident — the
 *  block itself is not scoped to a bench, see `assertNotBlocked`. */
export type ScanFlow = 'PACK' | 'HANDOVER';

export interface ScanBlockView {
  issueId: string;
  title: string;
  detail: string;
  shipmentNumber: string | null;
  raisedAt: Date;
}

/**
 * A box scanned twice puts THAT PARCEL on hold (AMENDED 2026-11-20, owner:
 * it used to stop the operator; the old operator-block read path below is
 * kept for blocks already in the DB, nothing new sets one).
 *
 * ── WHY A HARD STOP ──────────────────────────────────────────────────
 * Scanning the same parcel twice is not a harmless retry. It means one
 * of two things and both are wrong:
 *
 *   - a DUPLICATE LABEL exists, so two physical boxes carry one AWB and
 *     one of them will be delivered to nobody; or
 *   - the operator is working from a pile that has already been done,
 *     so whatever else is in that pile is suspect too.
 *
 * Either way the mistake gets more expensive the longer it runs, and
 * the person holding the box is the only one who can look at it. So the
 * scan refuses, and keeps refusing, until an admin has been and
 * resolved the issue — which is what "confirmed the error is gone"
 * means in a system: a named person, a note, a timestamp.
 *
 * ── WHY PER OPERATOR ─────────────────────────────────────────────────
 * Four packers work in parallel and a van is loaded while the next
 * order is still being packed. Halting the building because one bench
 * hit a duplicate would cost more than the duplicate does. The blocked
 * person stops; everybody else carries on.
 *
 * The block is not scoped to the BENCH though: somebody whose pile is
 * in doubt at pack should not simply walk to the handover table and
 * carry on. One stop, both benches, one clearance.
 *
 * ── WHY NOT A NEW TABLE ──────────────────────────────────────────────
 * `system_issues` already is "what is still wrong, until a person says
 * otherwise": it has the dedupe, the occurrence count, the acknowledge
 * step, and the resolve-with-a-note that IS the clearance — plus a
 * board somebody is already watching. A second table would be a second
 * half-built version of all of that.
 */
@Injectable()
export class ScanBlockService {
  private readonly logger = new Logger(ScanBlockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: SystemIssueService,
  ) {}

  /**
   * Refuse every scan while this operator is blocked.
   *
   * Called at the TOP of each scanning entry point, so the stop applies
   * to the next parcel too — not only to the one that caused it. That
   * is the whole point: the pile is in doubt, not just the box.
   *
   * Fails OPEN on a read failure. A warehouse that cannot pack because
   * a query failed is a worse outage than a missed duplicate, and the
   * duplicate still surfaces at the next scan.
   */
  async assertNotBlocked(staffId: string): Promise<void> {
    const block = await this.currentBlock(staffId);
    if (block === null) return;
    throw new ConflictException({
      code: 'SCAN_BLOCKED',
      message:
        `Scanning is stopped for you: ${block.title}. An admin has to clear this on the ` +
        `system issues board before you can carry on.`,
      issueId: block.issueId,
      detail: block.detail,
    });
  }

  /** What is currently stopping this operator, if anything. */
  async currentBlock(staffId: string): Promise<ScanBlockView | null> {
    try {
      const row = await this.prisma.client.systemIssue.findFirst({
        where: { blocksScanForStaffId: staffId, resolvedAt: null },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, title: true, detail: true, metadata: true, firstSeenAt: true },
      });
      if (row === null) return null;
      const meta = row.metadata as { shipmentNumber?: string } | null;
      return {
        issueId: row.id,
        title: row.title,
        detail: row.detail,
        shipmentNumber: meta?.shipmentNumber ?? null,
        raisedAt: row.firstSeenAt,
      };
    } catch (err) {
      this.logger.error(
        { staffId, err: err instanceof Error ? err.message : String(err) },
        'Could not read the scan block — failing open so the bench keeps working',
      );
      return null;
    }
  }

  /**
   * Refuse a parcel that has an unresolved duplicate-scan issue.
   * AMENDED 2026-11-20 (owner): only the parcel is held; the operator
   * may scan any other parcel. Fails OPEN on a read error.
   */
  async assertParcelNotOnHold(shipmentId: string, flow: ScanFlow): Promise<void> {
    let row: { id: string; metadata: unknown } | null = null;
    try {
      row = await this.prisma.client.systemIssue.findFirst({
        where: {
          kind: SystemIssueKind.WAREHOUSE_SCAN,
          resolvedAt: null,
          metadata: { path: ['shipmentId'], equals: shipmentId },
        },
        orderBy: { lastSeenAt: 'desc' },
        select: { id: true, metadata: true },
      });
    } catch (err) {
      this.logger.error(
        { shipmentId, flow, err: err instanceof Error ? err.message : String(err) },
        'Could not read the parcel hold — failing open so the bench keeps working',
      );
      return;
    }
    if (row === null) return;
    const meta = row.metadata as { shipmentNumber?: string } | null;
    const name = meta?.shipmentNumber ?? 'This parcel';
    throw new ConflictException({
      code: 'PARCEL_ON_HOLD',
      message:
        `Put this box aside. ${name} is on hold because it was scanned twice. An admin has ` +
        `to check it and resolve the issue on the system issues board (/system-issues) ` +
        `before it can be ${flow === 'PACK' ? 'packed' : 'handed to the courier'}. ` +
        `Carry on with the rest.`,
      issueId: row.id,
      shipmentNumber: meta?.shipmentNumber ?? null,
      // The error filter forwards only `details`, so the id must be here too.
      details: { issueId: row.id },
    });
  }

  /**
   * A duplicate was scanned: raise the incident and stop the operator.
   *
   * ALWAYS throws — the caller does not decide whether this is fatal.
   * Keyed on the PARCEL, because that is the thing that is wrong; the
   * same box scanned twice by two different people is one problem, and
   * the occurrence count says it happened more than once.
   */
  async refuseDuplicate(input: {
    flow: ScanFlow;
    staffId: string;
    shipmentId: string;
    shipmentNumber: string;
    awbNumber: string | null;
    /** What state the parcel was already in — the evidence. */
    observed: string;
  }): Promise<never> {
    const where = input.flow === 'PACK' ? 'the packing bench' : 'the handover bench';
    const title = `${input.shipmentNumber} was scanned again at ${where} — parcel on hold`;
    const detail =
      `This parcel is already ${input.observed}, and it has just been scanned again at ` +
      `${where}. That means either two boxes are carrying the same label — one of which ` +
      `will be delivered to nobody — or the operator is working from a pile that has ` +
      `already been done.\n\n` +
      `The PARCEL is on hold at both benches until this is resolved; the operator carries ` +
      `on with other parcels. Go and look at the physical box: find out whether there are ` +
      `two of them, and check the rest of that pile. Resolve this issue with a note saying ` +
      `what you found — that note is the only record of it, and it releases the parcel.`;

    await this.issues.raise({
      kind: SystemIssueKind.WAREHOUSE_SCAN,
      severity: SystemIssueSeverity.HIGH,
      title,
      detail,
      source: 'ScanBlockService',
      dedupeKey: `duplicate-scan:${input.flow}:${input.shipmentId}`,
      // AMENDED 2026-11-20 (owner): the PARCEL is held, not the operator.
      metadata: {
        flow: input.flow,
        shipmentId: input.shipmentId,
        shipmentNumber: input.shipmentNumber,
        awbNumber: input.awbNumber,
        observed: input.observed,
        scannedByStaffId: input.staffId,
      },
    });

    throw new ConflictException({
      code: 'DUPLICATE_SCAN',
      message:
        `Put this box aside. ${input.shipmentNumber} is on hold until an admin checks it — ` +
        `carry on with the rest.`,
      shipmentNumber: input.shipmentNumber,
    });
  }
}
