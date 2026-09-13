import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, OrderStatus, RtoDisposition, RtoItemCondition, TicketType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { OrderReadService } from '../../order/services/order-read.service';
import { TicketService } from '../../ticket/services/ticket.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  type ScrapTicketFacts,
  scrapTicketOpeningMessage,
  scrapTicketReinspectionNote,
} from './rto-scrap-ticket-message';
import {
  cleanNotes,
  effectiveRows,
  sameRows,
  summarizeRows,
  validateRows,
  type InspectionRow,
} from './rto-inspection-rows';

export interface InspectRtoRowInput {
  quantity: number;
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  notes?: string | null;
}

/**
 * Either ONE verdict for the whole line (`condition` + `disposition`), or
 * the line split BY QUANTITY (`rows`, WMS-8d) — never both.
 */
export interface InspectRtoItemInput {
  condition?: RtoItemCondition;
  disposition?: RtoDisposition;
  notes?: string | null;
  rows?: readonly InspectRtoRowInput[];
}

export interface InspectRtoItemResult {
  shipmentItemId: string;
  shipmentId: string;
  orderId: string;
  /** The line summary (`shipment_items.rto*`) — see `summarizeRows`. */
  rtoCondition: RtoItemCondition;
  rtoDisposition: RtoDisposition;
  rtoDisposedByStaffId: string;
  rtoInspectionNotes: string | null;
  /** The line by quantity; one row covering the whole line when unsplit. */
  rows: InspectionRow[];
}

/**
 * Module 8 — per-item RTO inspection (commit 14, WMS-8), BY QUANTITY since
 * WMS-8d (2026-09-13).
 *
 * The operator records each returned line's condition + intended
 * disposition. A line of qty 2 can come back one good and one damaged, so
 * a line may be SPLIT into rows, each with its own quantity, condition,
 * disposition and notes; the rows must add up to the line's quantity
 * exactly. An unsplit line is one row covering the whole quantity — the
 * single choice, which stays the default.
 *
 * `shipment_item_rto_inspections` is the truth per unit and this service
 * is its ONLY writer: a line's rows are replaced wholesale, after the
 * shipment_items row is updated (which takes the row lock), so two
 * inspectors saving the same line serialise instead of interleaving their
 * rows. The `shipment_items.rto*` columns keep a SUMMARY (`summarizeRows`)
 * for the readers that only ask "is this line decided / held / restocked".
 *
 * A line whose units carry serials (STRICT, UNIT-1/2) is NOT split: which
 * serial went which way is not recorded on a row, and the unit ledger
 * would have to guess. Refused by name (`RTO_SPLIT_SERIALIZED_LINE`); such
 * a line is inspected with one verdict, as before.
 *
 * Idempotent on re-inspection (operator may correct judgment); the update
 * overwrites prior values and re-audits. Gated on order.status ===
 * RTO_RECEIVED so inspection can only happen on a received parcel.
 */
@Injectable()
export class RtoInspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly audit: AuditLogService,
    private readonly tickets: TicketService,
  ) {}

  async inspect(
    shipmentItemId: string,
    input: InspectRtoItemInput,
    staffId: string,
    ctx?: ClientContext,
  ): Promise<InspectRtoItemResult> {
    const item = await this.prisma.client.shipmentItem.findUnique({
      where: { id: shipmentItemId },
      select: {
        id: true,
        shipmentId: true,
        skuCode: true,
        productName: true,
        // The scrap ticket's opening message states these (quantity) and
        // compares the prior finding with this one (a correction is said
        // on the ticket rather than left for the seller to notice).
        quantity: true,
        rtoCondition: true,
        rtoDisposition: true,
        rtoInspectionNotes: true,
        rtoInspections: {
          select: { quantity: true, condition: true, disposition: true, notes: true },
          orderBy: { position: 'asc' },
        },
        shipment: {
          select: {
            id: true,
            courierCode: true,
            shipmentNumber: true,
            awbNumber: true,
            rtoReceivedAt: true,
            rtoReceivedWarehouseId: true,
            originWarehouseId: true,
            orderShipments: {
              select: { orderId: true },
              orderBy: { shipmentSequence: 'asc' },
              take: 1,
            },
          },
        },
        // R7 — the seller who owns the returned goods; needed to raise
        // the scrap ticket against the right wallet.
        orderItem: { select: { order: { select: { sellerId: true } } } },
      },
    });
    if (!item) {
      throw new NotFoundException({
        code: 'SHIPMENT_ITEM_NOT_FOUND',
        message: `Shipment item ${shipmentItemId} not found`,
      });
    }
    const orderId = item.shipment.orderShipments[0]?.orderId;
    if (orderId === undefined) {
      throw new NotFoundException({
        code: 'ORDER_SHIPMENT_MISSING',
        message: 'Shipment item has no resolvable order',
      });
    }
    const order = await this.orders.getById(orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Order ${orderId} not found`,
      });
    }
    if (order.status !== OrderStatus.RTO_RECEIVED) {
      throw new ConflictException({
        code: 'ORDER_NOT_INSPECTABLE',
        message: `Order is ${order.status}; RTO inspection requires RTO_RECEIVED`,
      });
    }

    const rows = this.rowsFrom(item.quantity, input);
    if (rows.length > 1) {
      const serialized = await this.prisma.client.stockUnit.count({ where: { shipmentItemId } });
      if (serialized > 0) {
        throw new ConflictException({
          code: 'RTO_SPLIT_SERIALIZED_LINE',
          message:
            'This line carries serialised units, and a split cannot say which serial went which way. ' +
            'Inspect it with one verdict for the whole line.',
        });
      }
    }
    const summary = summarizeRows(rows);
    const prior = effectiveRows(item);

    // R7: the inspection write and the scrap ticket land in ONE tx. A
    // DAMAGED/MISSING judgement on ANY unit is exactly the moment a
    // liability claim comes into existence, so recording the judgement
    // without the ticket would reintroduce the silent-write-off gap.
    const damaged = rows.some((r) => isClaim(r.condition));
    // A RE-inspection that changes the finding — a condition, a
    // disposition, a note, or how the line is split. The ticket's opening
    // message is never edited (TKT-1 — the conversation is a record), so
    // the correction is said on it as a new message, in the same
    // transaction as the correction itself.
    const changed = prior.length > 0 && !sameRows(prior, rows);
    const correctsAClaim = !damaged && changed && prior.some((r) => isClaim(r.condition));
    const facts =
      damaged || correctsAClaim
        ? await this.scrapFacts(item, order.orderNumber, summary, rows)
        : null;
    const actor = { type: ActorType.STAFF, staffId };
    await this.prisma.client.$transaction(async (tx) => {
      // FIRST: the line row — its update takes the row lock, so a second
      // inspector saving this line waits here and then replaces what this
      // one wrote, rather than both sets of rows landing.
      await tx.shipmentItem.update({
        where: { id: shipmentItemId },
        data: {
          rtoCondition: summary.condition,
          rtoDisposition: summary.disposition,
          rtoDisposedByStaffId: staffId,
          rtoInspectionNotes: summary.notes,
        },
      });
      await tx.shipmentItemRtoInspection.deleteMany({ where: { shipmentItemId } });
      await tx.shipmentItemRtoInspection.createMany({
        data: rows.map((r, i) => ({
          shipmentItemId,
          position: i + 1,
          quantity: r.quantity,
          condition: r.condition,
          disposition: r.disposition,
          notes: r.notes,
        })),
      });

      if (damaged && facts !== null) {
        // Idempotent per (shipmentItem, SCRAP_DAMAGE) — ONE ticket per
        // line however it is split; re-inspecting returns the existing
        // ticket rather than stacking duplicates. The ticket OPENS with
        // our message stating the facts, unit-group by unit-group for a
        // split line; an inspector's notes are quoted inside it.
        const opened = await this.tickets.openOrFind(
          {
            ticketType: TicketType.SCRAP_DAMAGE,
            sellerId: item.orderItem.order.sellerId,
            subject: `RTO ${summary.condition}: ${item.productName} (${item.skuCode})`,
            descriptionFor: (ticketNumber) => scrapTicketOpeningMessage({ ...facts, ticketNumber }),
            orderId,
            shipmentId: item.shipmentId,
            shipmentItemId,
            courierCode: item.shipment.courierCode,
            rtoCondition: summary.condition,
          },
          actor,
          tx,
        );
        if (!opened.created && changed && opened.ticket.resolvedAt === null) {
          await this.tickets.addNote(
            opened.ticket.id,
            scrapTicketReinspectionNote(facts),
            actor,
            undefined,
            tx,
          );
        }
      } else if (correctsAClaim && facts !== null) {
        // Damaged/missing on first look, fine on the second: the ticket
        // stays (a person closes it), but it now says so.
        const existing = await this.tickets.findByShipmentItem(
          shipmentItemId,
          TicketType.SCRAP_DAMAGE,
          tx,
        );
        if (existing !== null && existing.resolvedAt === null) {
          await this.tickets.addNote(
            existing.id,
            scrapTicketReinspectionNote(facts),
            actor,
            undefined,
            tx,
          );
        }
      }
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staffId,
      action: 'rto.inspected',
      entityType: 'shipment_item',
      entityId: shipmentItemId,
      severity: 'MEDIUM',
      metadata: {
        orderId,
        shipmentId: item.shipmentId,
        condition: summary.condition,
        disposition: summary.disposition,
        rows: rows.map((r) => ({
          quantity: r.quantity,
          condition: r.condition,
          disposition: r.disposition,
        })),
        split: rows.length > 1,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentItemId,
      shipmentId: item.shipmentId,
      orderId,
      rtoCondition: summary.condition,
      rtoDisposition: summary.disposition,
      rtoDisposedByStaffId: staffId,
      rtoInspectionNotes: summary.notes,
      rows: [...rows],
    };
  }

  /**
   * The rows this request means. One verdict ⇒ one row covering the whole
   * line (the unsplit case, exactly as before). `rows` ⇒ validated to cover
   * the line's quantity exactly. Both, or neither, is refused rather than
   * guessed at.
   */
  private rowsFrom(lineQuantity: number, input: InspectRtoItemInput): InspectionRow[] {
    const single = input.condition !== undefined || input.disposition !== undefined;
    if (input.rows !== undefined && single) {
      throw new BadRequestException({
        code: 'RTO_INSPECTION_AMBIGUOUS',
        message:
          'Send either one condition and disposition for the whole line, or rows — not both.',
      });
    }
    let rows: InspectionRow[];
    if (input.rows !== undefined) {
      rows = input.rows.map((r) => ({
        quantity: r.quantity,
        condition: r.condition,
        disposition: r.disposition,
        notes: cleanNotes(r.notes),
      }));
    } else {
      if (input.condition === undefined || input.disposition === undefined) {
        throw new BadRequestException({
          code: 'RTO_INSPECTION_INCOMPLETE_INPUT',
          message: 'A condition and a disposition are both needed.',
        });
      }
      rows = [
        {
          quantity: lineQuantity,
          condition: input.condition,
          disposition: input.disposition,
          notes: cleanNotes(input.notes),
        },
      ];
    }
    const invalid = validateRows(lineQuantity, rows);
    if (invalid !== null) {
      switch (invalid.code) {
        case 'RTO_SPLIT_EMPTY':
          throw new BadRequestException({
            code: invalid.code,
            message: 'A split needs at least one row.',
          });
        case 'RTO_SPLIT_ROW_QUANTITY_INVALID':
          throw new BadRequestException({
            code: invalid.code,
            message: `Row ${invalid.position} must cover at least one whole unit.`,
          });
        case 'RTO_SPLIT_QUANTITY_MISMATCH':
          throw new BadRequestException({
            code: invalid.code,
            message:
              `The rows cover ${invalid.rowsQuantity} unit(s) but this line has ${invalid.lineQuantity}. ` +
              'Every returned unit needs exactly one decision.',
          });
      }
    }
    return rows;
  }

  /**
   * The facts the scrap ticket states. The warehouse is where the parcel
   * came back to — the receiving one, else the origin (a NULL receiving
   * warehouse means received at the origin, R6). A missing warehouse row
   * just leaves the "at …" off; it never costs the seller the message.
   */
  private async scrapFacts(
    item: {
      productName: string;
      skuCode: string;
      quantity: number;
      shipment: {
        shipmentNumber: string;
        awbNumber: string | null;
        rtoReceivedAt: Date | null;
        rtoReceivedWarehouseId: string | null;
        originWarehouseId: string;
      };
    },
    orderNumber: string,
    summary: { condition: RtoItemCondition; disposition: RtoDisposition; notes: string | null },
    rows: readonly InspectionRow[],
  ): Promise<ScrapTicketFacts> {
    const warehouseId = item.shipment.rtoReceivedWarehouseId ?? item.shipment.originWarehouseId;
    const warehouse = await this.prisma.client.warehouse.findUnique({
      where: { id: warehouseId },
      select: { code: true, name: true, timezone: true },
    });
    return {
      productName: item.productName,
      skuCode: item.skuCode,
      quantity: item.quantity,
      condition: summary.condition,
      disposition: summary.disposition,
      orderNumber,
      shipmentNumber: item.shipment.shipmentNumber,
      awbNumber: item.shipment.awbNumber,
      receivedAt: item.shipment.rtoReceivedAt,
      receivedWarehouse: warehouse,
      notes: summary.notes,
      rows,
    };
  }
}

/** A finding that opens a scrap/damage claim. */
function isClaim(condition: RtoItemCondition | null): boolean {
  return condition === RtoItemCondition.DAMAGED || condition === RtoItemCondition.MISSING;
}
