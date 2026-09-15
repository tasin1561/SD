import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  LabelReprintRequestStatus,
  NotificationCategory,
  NotificationChannel,
} from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { ConsignmentLabelService, type LabelSheet } from './consignment-label.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * How long an approval stays good. Approving is permission to put ONE
 * new sticker on a box somebody is holding now, not a standing licence:
 * a day later the box has moved, the person has gone home, and the
 * question has to be asked again. A constant rather than a setting on
 * purpose — nobody should be able to widen this without a change review.
 */
export const REPRINT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/** The in-app topic approvers are told on (NOTIF-17 catalogue key). */
export const LABEL_REPRINT_REQUESTED_TOPIC = 'label_reprint.requested';

/** Who may approve or reject — and who is told a request is waiting. */
export const LABEL_REPRINT_APPROVER_PERMISSION = 'warehouse.labels.reprint';

/**
 * What a request IS now. "Expired" is never stored: it is an APPROVED row
 * whose `decidedAt` is older than the window, and `decidedAt` is written
 * once, by the decision, and by nothing else (CLAUDE 4b).
 */
export type LabelReprintState = LabelReprintRequestStatus | 'EXPIRED';

export function reprintState(
  row: { readonly status: LabelReprintRequestStatus; readonly decidedAt: Date | null },
  now: Date,
): LabelReprintState {
  if (
    row.status === LabelReprintRequestStatus.APPROVED &&
    row.decidedAt !== null &&
    now.getTime() - row.decidedAt.getTime() >= REPRINT_APPROVAL_TTL_MS
  ) {
    return 'EXPIRED';
  }
  return row.status;
}

export interface LabelReprintRequestView {
  readonly id: string;
  readonly consignmentId: string;
  readonly consignmentNumber: string;
  readonly serials: readonly string[];
  readonly reason: string;
  readonly state: LabelReprintState;
  readonly requestedBy: { readonly id: string; readonly email: string | null };
  readonly requestedAt: Date;
  readonly decidedBy: { readonly id: string; readonly email: string | null } | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  /** When an approval stops being printable; null unless approved. */
  readonly approvalExpiresAt: Date | null;
  readonly printedAt: Date | null;
}

const STAFF_REF = { select: { id: true, emailDisplay: true } } as const;

const REQUEST_SELECT = {
  id: true,
  consignmentId: true,
  sellerId: true,
  serials: true,
  reason: true,
  status: true,
  requestedByStaffId: true,
  decidedByStaffId: true,
  decidedAt: true,
  decisionNote: true,
  printedAt: true,
  createdAt: true,
  consignment: { select: { consignmentNumber: true } },
  requestedBy: STAFF_REF,
  decidedBy: STAFF_REF,
} as const;

interface RequestRow {
  readonly id: string;
  readonly consignmentId: string;
  readonly sellerId: string;
  readonly serials: string[];
  readonly reason: string;
  readonly status: LabelReprintRequestStatus;
  readonly requestedByStaffId: string;
  readonly decidedByStaffId: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly printedAt: Date | null;
  readonly createdAt: Date;
  readonly consignment: { readonly consignmentNumber: string };
  readonly requestedBy: { readonly id: string; readonly emailDisplay: string | null };
  readonly decidedBy: { readonly id: string; readonly emailDisplay: string | null } | null;
}

/**
 * LBL-5b (2026-09-15): reprinting a STRICT serial label takes TWO people.
 *
 * The owner: a damaged label "can be print but with a extra permission
 * who will approve this printing but can't print the whole sheet just the
 * specific damaged one" — and, asked how, "Request, then approve".
 *
 *   1. REQUEST — anyone who labels goods names the damaged units (at most
 *      25, all on this consignment) and says why. Nothing is printed.
 *   2. APPROVE or REJECT — somebody holding `warehouse.labels.reprint`
 *      who is NOT the requester. A person cannot approve their own
 *      request, or the second person is the same person.
 *   3. PRINT — the REQUESTER prints it, ONCE, within 24h of the approval.
 *      The approver cannot print it: the two-person rule means neither
 *      of them can produce a sticker alone.
 *
 * Every state change is a guarded `updateMany` on the state it read, so
 * two approvers, or two print presses, cannot both win. The only writer
 * of `label_reprint_requests`.
 */
@Injectable()
export class LabelReprintRequestService {
  private readonly logger = new Logger(LabelReprintRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly labels: ConsignmentLabelService,
    private readonly dispatch: NotificationDispatchService,
  ) {}

  async request(
    staffId: string,
    consignmentId: string,
    serials: readonly string[],
    reason: string,
    ctx: ClientContext,
  ): Promise<LabelReprintRequestView> {
    // Validated NOW, at the bench, so a mistyped serial is named to the
    // person holding the box rather than to an approver who is not.
    const { consignment, serials: wanted } = await this.labels.unitsForReprint(
      consignmentId,
      serials,
    );
    const trimmedReason = reason.trim();

    const created = await this.prisma.client.$transaction(async (tx) => {
      // "Is any of these serials already on an open request?" then an
      // insert: two people reporting the same box at once would each see
      // the other missing, and two approvals would mean two new stickers.
      await takeAdvisoryLock(tx, AdvisoryLock.LABEL_REPRINT, consignmentId);
      const cutoff = new Date(Date.now() - REPRINT_APPROVAL_TTL_MS);
      const open = await tx.labelReprintRequest.findMany({
        where: {
          consignmentId,
          serials: { hasSome: [...wanted] },
          OR: [
            { status: LabelReprintRequestStatus.PENDING },
            { status: LabelReprintRequestStatus.APPROVED, decidedAt: { gt: cutoff } },
          ],
        },
        select: { serials: true },
      });
      if (open.length > 0) {
        const taken = new Set(open.flatMap((o) => o.serials));
        throw new ConflictException({
          code: 'REPRINT_ALREADY_REQUESTED',
          message:
            `Already waiting on a reprint request: ${wanted.filter((s) => taken.has(s)).join(', ')}. ` +
            'Approve, reject or print that one first.',
        });
      }

      const row = await tx.labelReprintRequest.create({
        data: {
          consignmentId,
          sellerId: consignment.sellerId,
          serials: [...wanted],
          reason: trimmedReason,
          requestedByStaffId: staffId,
        },
        select: { id: true },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: consignment.sellerId,
          action: 'consignment.label_reprint.requested',
          entityType: 'label_reprint_request',
          entityId: row.id,
          severity: 'MEDIUM',
          metadata: {
            consignmentId,
            consignmentNumber: consignment.consignmentNumber,
            serials: [...wanted],
            count: wanted.length,
            reason: trimmedReason,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
            requestId: ctx.requestId ?? null,
          },
        },
        tx,
      );
      return row;
    });

    const view = await this.view(created.id);
    await this.tellApprovers(view);
    return view;
  }

  async approve(
    staffId: string,
    requestId: string,
    note: string | undefined,
    ctx: ClientContext,
  ): Promise<LabelReprintRequestView> {
    const req = await this.require(requestId);
    this.assertNotRequester(req, staffId);
    this.assertPending(req);

    const decisionNote = note?.trim() ? note.trim() : null;
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.labelReprintRequest.updateMany({
        where: {
          id: requestId,
          status: LabelReprintRequestStatus.PENDING,
          requestedByStaffId: { not: staffId },
        },
        data: {
          status: LabelReprintRequestStatus.APPROVED,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
          decisionNote,
        },
      });
      if (claimed.count === 0) throw this.alreadyDecided(req.consignment.consignmentNumber);
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: req.sellerId,
          action: 'consignment.label_reprint.approved',
          entityType: 'label_reprint_request',
          entityId: requestId,
          severity: 'HIGH',
          metadata: {
            consignmentId: req.consignmentId,
            consignmentNumber: req.consignment.consignmentNumber,
            serials: req.serials,
            requestedByStaffId: req.requestedByStaffId,
            note: decisionNote,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
            requestId: ctx.requestId ?? null,
          },
        },
        tx,
      );
    });
    return this.view(requestId);
  }

  async reject(
    staffId: string,
    requestId: string,
    note: string,
    ctx: ClientContext,
  ): Promise<LabelReprintRequestView> {
    const req = await this.require(requestId);
    this.assertNotRequester(req, staffId);
    this.assertPending(req);

    const decisionNote = note.trim();
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.labelReprintRequest.updateMany({
        where: {
          id: requestId,
          status: LabelReprintRequestStatus.PENDING,
          requestedByStaffId: { not: staffId },
        },
        data: {
          status: LabelReprintRequestStatus.REJECTED,
          decidedByStaffId: staffId,
          decidedAt: new Date(),
          decisionNote,
        },
      });
      if (claimed.count === 0) throw this.alreadyDecided(req.consignment.consignmentNumber);
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: req.sellerId,
          action: 'consignment.label_reprint.rejected',
          entityType: 'label_reprint_request',
          entityId: requestId,
          severity: 'MEDIUM',
          metadata: {
            consignmentId: req.consignmentId,
            consignmentNumber: req.consignment.consignmentNumber,
            serials: req.serials,
            requestedByStaffId: req.requestedByStaffId,
            note: decisionNote,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
            requestId: ctx.requestId ?? null,
          },
        },
        tx,
      );
    });
    return this.view(requestId);
  }

  /**
   * The sheet for an APPROVED request — once, by the person who asked.
   *
   * The claim (APPROVED → PRINTED) and the record on each unit's ledger
   * are one transaction, so a print that fails half-way leaves the
   * request approved and printable, and two presses of the button print
   * one sheet between them.
   */
  async print(staffId: string, requestId: string, ctx: ClientContext): Promise<LabelSheet> {
    const req = await this.require(requestId);
    if (req.requestedByStaffId !== staffId) {
      throw new ForbiddenException({
        code: 'REPRINT_NOT_REQUESTER',
        message:
          `Only ${req.requestedBy.emailDisplay ?? 'the person who asked'} can print this — ` +
          'the person who found the damaged box is the one who labels it.',
      });
    }
    const now = new Date();
    const state = reprintState(req, now);
    switch (state) {
      case LabelReprintRequestStatus.APPROVED:
        break;
      case LabelReprintRequestStatus.PENDING:
        throw new ConflictException({
          code: 'REPRINT_NOT_APPROVED',
          message: 'Nobody has approved this reprint yet.',
        });
      case LabelReprintRequestStatus.REJECTED:
        throw new ConflictException({
          code: 'REPRINT_REJECTED',
          message: `This reprint was rejected${req.decisionNote ? `: ${req.decisionNote}` : '.'}`,
        });
      case LabelReprintRequestStatus.PRINTED:
        throw this.alreadyPrinted(req.printedAt);
      case 'EXPIRED':
        throw new ConflictException({
          code: 'REPRINT_APPROVAL_EXPIRED',
          message:
            'This approval is more than 24 hours old and can no longer be printed. ' +
            'Ask again if the label still needs replacing.',
        });
      default: {
        const exhaustive: never = state;
        throw new Error(`Unhandled reprint state: ${String(exhaustive)}`);
      }
    }

    // Read again: a unit may have left the consignment since the request.
    const { consignment, units } = await this.labels.unitsForReprint(
      req.consignmentId,
      req.serials,
    );
    const printedAt = new Date();
    const cutoff = new Date(printedAt.getTime() - REPRINT_APPROVAL_TTL_MS);
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.labelReprintRequest.updateMany({
        where: {
          id: requestId,
          status: LabelReprintRequestStatus.APPROVED,
          requestedByStaffId: staffId,
          decidedAt: { gt: cutoff },
        },
        data: {
          status: LabelReprintRequestStatus.PRINTED,
          printedByStaffId: staffId,
          printedAt,
        },
      });
      if (claimed.count === 0) throw this.alreadyPrinted(null);
      await this.labels.recordReprint(tx, {
        consignmentId: req.consignmentId,
        sellerId: req.sellerId,
        serials: req.serials,
        reason: req.reason,
        staffId,
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: req.sellerId,
          action: 'consignment.labels_reprinted',
          entityType: 'consignment',
          entityId: req.consignmentId,
          severity: 'HIGH',
          metadata: {
            consignmentNumber: consignment.consignmentNumber,
            reprintRequestId: requestId,
            serials: req.serials,
            count: req.serials.length,
            reason: req.reason,
            requestedByStaffId: req.requestedByStaffId,
            approvedByStaffId: req.decidedByStaffId,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
            requestId: ctx.requestId ?? null,
          },
        },
        tx,
      );
    });

    this.logger.log(
      { consignmentId: req.consignmentId, requestId, count: req.serials.length },
      'Approved label reprint printed',
    );
    return this.labels.sheetFor(consignment, units, printedAt);
  }

  /** This consignment's requests, newest first. */
  async list(consignmentId: string): Promise<LabelReprintRequestView[]> {
    const rows = await this.prisma.client.labelReprintRequest.findMany({
      where: { consignmentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: REQUEST_SELECT,
    });
    const now = new Date();
    return rows.map((r) => toView(r, now));
  }

  private async view(requestId: string): Promise<LabelReprintRequestView> {
    return toView(await this.require(requestId), new Date());
  }

  private async require(requestId: string): Promise<RequestRow> {
    const row = await this.prisma.client.labelReprintRequest.findUnique({
      where: { id: requestId },
      select: REQUEST_SELECT,
    });
    if (row === null) {
      throw new NotFoundException({
        code: 'REPRINT_REQUEST_NOT_FOUND',
        message: 'No such reprint request.',
      });
    }
    return row;
  }

  private assertNotRequester(req: RequestRow, staffId: string): void {
    if (req.requestedByStaffId === staffId) {
      throw new ForbiddenException({
        code: 'REPRINT_SELF_APPROVAL',
        message:
          'You asked for this reprint, so somebody else has to decide it — ' +
          'that is the whole point of a second person.',
      });
    }
  }

  private assertPending(req: RequestRow): void {
    if (req.status !== LabelReprintRequestStatus.PENDING) {
      throw this.alreadyDecided(req.consignment.consignmentNumber);
    }
  }

  private alreadyDecided(consignmentNumber: string): ConflictException {
    return new ConflictException({
      code: 'REPRINT_ALREADY_DECIDED',
      message: `This reprint request on ${consignmentNumber} has already been decided.`,
    });
  }

  private alreadyPrinted(printedAt: Date | null): ConflictException {
    return new ConflictException({
      code: 'REPRINT_ALREADY_PRINTED',
      message:
        printedAt === null
          ? 'This reprint was printed (or its approval lapsed) a moment ago. It prints once.'
          : `This reprint was printed on ${printedAt
              .toISOString()
              .slice(0, 16)
              .replace('T', ' ')} UTC. It prints once — a new sticker needs a new request.`,
    });
  }

  /**
   * Tell everyone who can approve. In-app only, addressed by the
   * PERMISSION rather than a role (NOTIF-10), one delivery per request
   * (the event id is the NOTIF-2 dedup key). Awaited after the request
   * commits and never thrown: the request is the fact, the notice is its
   * reflection (NOTIF-1), and awaiting it rather than firing and
   * forgetting means nothing outlives the HTTP call (NOTIF-19).
   */
  private async tellApprovers(view: LabelReprintRequestView): Promise<void> {
    try {
      await this.dispatch.dispatch({
        topic: LABEL_REPRINT_REQUESTED_TOPIC,
        category: NotificationCategory.OPERATIONAL,
        title: `Label reprint waiting for approval — ${view.consignmentNumber}`,
        body:
          `${view.requestedBy.email ?? 'A colleague'} asked to reprint ${view.serials.length} ` +
          `serial label(s) on ${view.consignmentNumber}: ${view.serials.join(', ')}. ` +
          `Why: ${view.reason}. Somebody other than them approves or rejects it on the ` +
          'consignment page.',
        channels: [NotificationChannel.IN_APP],
        audience: [{ kind: 'STAFF_PERMISSION', permission: LABEL_REPRINT_APPROVER_PERMISSION }],
        triggerEvent: LABEL_REPRINT_REQUESTED_TOPIC,
        eventId: `label_reprint:${view.id}:requested`,
      });
    } catch (err) {
      this.logger.warn(
        { requestId: view.id, err: err instanceof Error ? err.message : String(err) },
        'Could not tell approvers about a label reprint request — it is still on the consignment page',
      );
    }
  }
}

function toView(r: RequestRow, now: Date): LabelReprintRequestView {
  const state = reprintState(r, now);
  return {
    id: r.id,
    consignmentId: r.consignmentId,
    consignmentNumber: r.consignment.consignmentNumber,
    serials: r.serials,
    reason: r.reason,
    state,
    requestedBy: { id: r.requestedBy.id, email: r.requestedBy.emailDisplay },
    requestedAt: r.createdAt,
    decidedBy:
      r.decidedBy === null ? null : { id: r.decidedBy.id, email: r.decidedBy.emailDisplay },
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    approvalExpiresAt:
      r.status === LabelReprintRequestStatus.APPROVED && r.decidedAt !== null
        ? new Date(r.decidedAt.getTime() + REPRINT_APPROVAL_TTL_MS)
        : null,
    printedAt: r.printedAt,
  };
}
