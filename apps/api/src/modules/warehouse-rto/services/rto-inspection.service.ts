import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

export interface InspectRtoItemInput {
  condition: RtoItemCondition;
  disposition: RtoDisposition;
  notes?: string | null;
}

export interface InspectRtoItemResult {
  shipmentItemId: string;
  shipmentId: string;
  orderId: string;
  rtoCondition: RtoItemCondition;
  rtoDisposition: RtoDisposition;
  rtoDisposedByStaffId: string;
  rtoInspectionNotes: string | null;
}

/**
 * Module 8 — per-item RTO inspection (commit 14, WMS-8). The
 * warehouse operator records each returned line's condition + intended
 * disposition. Multiple shipment_items per parcel inspected separately;
 * finalize (commit 15) requires ALL lines inspected before atomic
 * disposition.
 *
 * Pick-allocation source-of-truth invariant (CP1 Option A): the
 * authoritative pick context is the phase-2 reservations; shipment_items
 * is operational metadata. RTO inspection follows the same pattern —
 * shipment_items.rto* columns are operational, NOT cross-domain authority.
 *
 * Idempotent on re-inspection (operator may correct judgment); the
 * update overwrites prior values and re-audits. Gated on order.status
 * === RTO_RECEIVED so inspection can only happen on a received parcel.
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

    const notes = input.notes ?? null;
    // R7: the inspection write and the scrap ticket land in ONE tx. A
    // DAMAGED/MISSING judgement is exactly the moment a liability claim
    // comes into existence, so recording the judgement without the
    // ticket would reintroduce the silent-write-off gap this closes.
    const damaged = isClaim(input.condition);
    // A RE-inspection that changes the finding. The ticket's opening
    // message is never edited (TKT-1 — the conversation is a record), so
    // the correction is said on it as a new message, in the same
    // transaction as the correction itself.
    const changed =
      item.rtoCondition !== null &&
      (item.rtoCondition !== input.condition ||
        item.rtoDisposition !== input.disposition ||
        (item.rtoInspectionNotes ?? null) !== notes);
    const correctsAClaim = !damaged && changed && isClaim(item.rtoCondition);
    const facts =
      damaged || correctsAClaim
        ? await this.scrapFacts(item, order.orderNumber, input.condition, input.disposition, notes)
        : null;
    const actor = { type: ActorType.STAFF, staffId };
    await this.prisma.client.$transaction(async (tx) => {
      await tx.shipmentItem.update({
        where: { id: shipmentItemId },
        data: {
          rtoCondition: input.condition,
          rtoDisposition: input.disposition,
          rtoDisposedByStaffId: staffId,
          rtoInspectionNotes: notes,
        },
      });

      if (damaged && facts !== null) {
        // Idempotent per (shipmentItem, SCRAP_DAMAGE) — re-inspecting a
        // line to correct a judgement returns the existing ticket rather
        // than stacking duplicates. The ticket OPENS with our message
        // stating the facts; an inspector's notes are quoted inside it.
        const opened = await this.tickets.openOrFind(
          {
            ticketType: TicketType.SCRAP_DAMAGE,
            sellerId: item.orderItem.order.sellerId,
            subject: `RTO ${input.condition}: ${item.productName} (${item.skuCode})`,
            descriptionFor: (ticketNumber) => scrapTicketOpeningMessage({ ...facts, ticketNumber }),
            orderId,
            shipmentId: item.shipmentId,
            shipmentItemId,
            courierCode: item.shipment.courierCode,
            rtoCondition: input.condition,
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
        condition: input.condition,
        disposition: input.disposition,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });

    return {
      shipmentItemId,
      shipmentId: item.shipmentId,
      orderId,
      rtoCondition: input.condition,
      rtoDisposition: input.disposition,
      rtoDisposedByStaffId: staffId,
      rtoInspectionNotes: notes,
    };
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
    condition: RtoItemCondition,
    disposition: RtoDisposition,
    notes: string | null,
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
      condition,
      disposition,
      orderNumber,
      shipmentNumber: item.shipment.shipmentNumber,
      awbNumber: item.shipment.awbNumber,
      receivedAt: item.shipment.rtoReceivedAt,
      receivedWarehouse: warehouse,
      notes,
    };
  }
}

/** A finding that opens a scrap/damage claim. */
function isClaim(condition: RtoItemCondition | null): boolean {
  return condition === RtoItemCondition.DAMAGED || condition === RtoItemCondition.MISSING;
}
