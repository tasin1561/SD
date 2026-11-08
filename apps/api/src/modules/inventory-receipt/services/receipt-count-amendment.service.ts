import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { ActorType, ConsignmentEventType, GoodsReceiptStatus, TicketType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { TicketService, type TicketActor } from '../../ticket/services/ticket.service';
import { GoodsReceiptService } from './goods-receipt.service';

export interface AmendCountInput {
  readonly receivedQty: number;
  readonly damagedQty?: number | undefined;
  readonly reason: string;
}

export interface AmendCountResult {
  readonly receiptId: string;
  readonly lineId: string;
  readonly receivedQty: number;
  readonly damagedQty: number;
  readonly previousReceivedQty: number;
  readonly previousDamagedQty: number;
  /** Null when the post-commit ticket step failed (it is audited HIGH). */
  readonly ticket: { id: string; ticketNumber: string; created: boolean } | null;
}

interface ClientContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

/**
 * Staff overriding the counted quantity of a leg that is still ARRIVING.
 *
 * Only while ARRIVING: a COMPLETED count has already become batches,
 * RECEIVING movements and stock levels (and, on a dispatched leg, driven
 * the India leg's expected quantity), so rewriting the line alone would
 * leave stock silently disagreeing with it. That correction is a stock
 * adjustment (INV-1) — refused here with RECEIPT_COUNT_ALREADY_BANKED.
 *
 * Variance stays a number (CNS-3): no gate, either direction, including
 * above the declared quantity. `consignments.status` is untouched (CNS-6).
 *
 * The ticket reflection runs AFTER the commit and never throws, the same
 * posture as `ReceiptShortfallTicketService.afterCompletion`.
 */
@Injectable()
export class ReceiptCountAmendmentService {
  private readonly logger = new Logger(ReceiptCountAmendmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly receipts: GoodsReceiptService,
    private readonly consignmentEvents: ConsignmentEventService,
    private readonly tickets: TicketService,
    private readonly catalog: CatalogReadService,
  ) {}

  async amend(
    staffId: string,
    receiptId: string,
    lineId: string,
    input: AmendCountInput,
    ctx: ClientContext,
  ): Promise<AmendCountResult> {
    const reason = input.reason.trim();
    const receipt = await this.receipts.getForAdmin(receiptId);
    if (receipt.status === GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'RECEIPT_COUNT_ALREADY_BANKED',
        message:
          'This count has already become stock, so it can no longer be edited here. Correct it with a stock adjustment.',
      });
    }
    this.receipts.assertStatus(receipt.status, [GoodsReceiptStatus.ARRIVING], 'amend the count of');
    const line = receipt.lines.find((l) => l.id === lineId);
    if (!line) {
      throw new NotFoundException({
        code: 'RECEIPT_LINE_NOT_FOUND',
        message: `Line ${lineId} is not part of this receipt`,
      });
    }

    const prevReceived = line.receivedQty;
    const prevDamaged = line.damagedQty;
    const nextReceived = input.receivedQty;
    const nextDamaged = input.damagedQty ?? prevDamaged;

    await this.prisma.client.$transaction(async (tx) => {
      // Guarded write: the status was read above, outside this tx, so the
      // line is re-checked against ARRIVING where it is written. A
      // completion racing in between flips the receipt and updates 0 rows.
      const updated = await tx.goodsReceiptLine.updateMany({
        where: { id: lineId, receiptId, receipt: { status: GoodsReceiptStatus.ARRIVING } },
        data: { receivedQty: nextReceived, damagedQty: nextDamaged, countedAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'RECEIPT_COUNT_ALREADY_BANKED',
          message:
            'This count has already become stock, so it can no longer be edited here. Correct it with a stock adjustment.',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: receipt.sellerId,
          action: 'inventory.goods_receipt.count_amended',
          entityType: 'goods_receipt',
          entityId: receiptId,
          severity: 'HIGH',
          changes: {
            receivedQty: { before: prevReceived, after: nextReceived },
            damagedQty: { before: prevDamaged, after: nextDamaged },
          },
          metadata: {
            lineId,
            reason,
            actorStaffId: staffId,
            receiptNumber: receipt.receiptNumber,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      if (receipt.consignmentId) {
        await this.consignmentEvents.append(
          {
            consignmentId: receipt.consignmentId,
            type: ConsignmentEventType.VARIANCE_RECORDED,
            description: `Count amended on ${receipt.receiptNumber}: received ${prevReceived} → ${nextReceived}. Reason: ${reason}`,
            data: {
              receiptId,
              lineId,
              receivedQty: { before: prevReceived, after: nextReceived },
              damagedQty: { before: prevDamaged, after: nextDamaged },
              amended: true,
            },
            actorType: ActorType.STAFF,
            actorId: staffId,
            // Staff reasons are internal wording; the seller is told via the ticket.
            isVisibleToSeller: false,
          },
          tx,
        );
      }
    });

    const ticket = await this.reflectOnTicket(staffId, receipt, line, {
      prevReceived,
      prevDamaged,
      nextReceived,
      nextDamaged,
      reason,
    });

    return {
      receiptId,
      lineId,
      receivedQty: nextReceived,
      damagedQty: nextDamaged,
      previousReceivedQty: prevReceived,
      previousDamagedQty: prevDamaged,
      ticket,
    };
  }

  /**
   * Post-commit, never throws. Finds the leg's RECEIPT_SHORTFALL ticket
   * and notes the amendment on it, or opens one so it is never silent.
   *
   * RECEIPT_SHORTFALL is reused: it is keyed (unique) on the leg, so one
   * leg keeps one conversation about its count, and the type already
   * means "the number counted on this leg needs answering for". A new
   * type would split that thread in two.
   *
   * A RESOLVED ticket is NOT reopened: a status change on a closed
   * claim (it may have refunded money) is not ours to make from a count
   * edit, and the unique key forbids a second ticket for the leg. The
   * note is appended to its timeline without `openOnly` so the record
   * stays whole for whoever audits the outcome.
   */
  private async reflectOnTicket(
    staffId: string,
    receipt: { id: string; sellerId: string; receiptNumber: string },
    line: { variantId: string; expectedQty: number },
    c: {
      prevReceived: number;
      prevDamaged: number;
      nextReceived: number;
      nextDamaged: number;
      reason: string;
    },
  ): Promise<AmendCountResult['ticket']> {
    const actor: TicketActor = { type: ActorType.STAFF, staffId };
    try {
      let sku = line.variantId;
      try {
        const v = (await this.catalog.getVariantsByIds([line.variantId])).get(line.variantId);
        if (v) sku = v.skuCode;
      } catch {
        // The SKU is only wording; the variant id stands in.
      }
      /*
        What the SELLER is told, and nothing more.

        A ticket note has no internal mode: `TicketService.addNote` writes
        a plain `ticketEvent` and hands it to the notifier, so every word
        here reaches the client. Two things therefore do NOT belong in it:

          · the staff `reason`, which is a free-text justification for
            overriding a physical count ("Riya miscounted, she is new") —
            written for an auditor, not for the customer whose stock it is;
          · the raw `staffId`, which is an internal uuid and says nothing
            to anyone outside this system.

        Both are already recorded where they are useful and private: the
        reason in `audit_logs` under `inventory.goods_receipt.count_amended`
        (with the actor), and again on the consignment event, which is
        written `isVisibleToSeller: false`.

        What remains is what the seller has an actual right to know,
        because it is their stock: the count on their goods changed, by
        how much, and against what was declared.
      */
      const note =
        `Count amended on ${receipt.receiptNumber}: ${sku} received ` +
        `${c.prevReceived} → ${c.nextReceived} (declared ${line.expectedQty}), ` +
        `damaged ${c.prevDamaged} → ${c.nextDamaged}.`;

      const existing = await this.prisma.client.ticket.findUnique({
        where: {
          goodsReceiptId_ticketType: {
            goodsReceiptId: receipt.id,
            ticketType: TicketType.RECEIPT_SHORTFALL,
          },
        },
        select: { id: true, ticketNumber: true },
      });
      if (existing) {
        await this.tickets.addNote(existing.id, note, actor);
        return { id: existing.id, ticketNumber: existing.ticketNumber, created: false };
      }
      const opened = await this.tickets.openOrFind(
        {
          ticketType: TicketType.RECEIPT_SHORTFALL,
          sellerId: receipt.sellerId,
          subject: `Count amended on ${receipt.receiptNumber}`,
          description: note,
          goodsReceiptId: receipt.id,
        },
        actor,
      );
      return {
        id: opened.ticket.id,
        ticketNumber: opened.ticket.ticketNumber,
        created: opened.created,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { receiptId: receipt.id, err: message },
        'Count amendment committed but its ticket could not be written',
      );
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: staffId,
        action: 'inventory.goods_receipt.count_amend_ticket_failed',
        entityType: 'goods_receipt',
        entityId: receipt.id,
        severity: 'HIGH',
        metadata: { error: message, reason: c.reason },
      });
      return null;
    }
  }
}
