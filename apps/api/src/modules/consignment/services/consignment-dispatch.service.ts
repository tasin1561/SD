import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  GoodsReceiptStatus,
  LabellingSite,
  StockMovementType,
  StockUnitStatus,
} from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { ConsignmentStatusService } from '../../consignment-core/services/consignment-status.service';
import { BinPolicyService } from '../../inventory-shared/bin-policy.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import { ShipmentNumberingService } from '../../shipment-provision/services/shipment-numbering.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { EnvService } from '../../../config/env.service';
import { NotificationRecipientType } from '@skydrop/db';
import { ConsignmentService } from './consignment.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface DispatchResult {
  readonly legReceiptId: string;
  readonly legReceiptNumber: string;
  readonly unitsDispatched: number;
  readonly lines: ReadonlyArray<{ variantId: string; quantity: number }>;
}

/**
 * Sending a counted Bangladesh intake on to India.
 *
 * Driven from the consignment panel rather than the generic transfers
 * screen, because every consignment's destination is India — this is a
 * step in a journey, not an ad-hoc stock move somebody might decide to
 * make. It does three things atomically:
 *
 *  1. Creates the INDIA LEG as an ordinary goods receipt, with
 *     `expectedQty` = what left Bangladesh. The receipt IS the shipment:
 *     when it lands, the receiving station counts it like anything else
 *     and the difference from `expectedQty` is the transit variance.
 *  2. Moves the stock BD bin -> the Indian warehouse's TRANSIT bin, as a
 *     paired TRANSFER_OUT/TRANSFER_IN through the INV-1 sole writer.
 *     TRANSIT is non-pickable, so from this moment the goods are on hand,
 *     really ours, and sellable from nowhere.
 *  3. Carries the BATCH across via a deterministic child batch, so expiry,
 *     unit cost and lineage survive the border. Same shape as R6b's
 *     cross-warehouse RTO restock — a generic "August air shipment" batch
 *     would make six-month-old stock look as fresh as today's.
 *
 * A consignment may be dispatched MORE THAN ONCE. A 500-unit intake often
 * flies in two shipments, so each dispatch is its own leg with its own
 * arrival count; what is left in Bangladesh stays available to dispatch.
 */
@Injectable()
export class ConsignmentDispatchService {
  private readonly logger = new Logger(ConsignmentDispatchService.name);

  constructor(
    private readonly audit: AuditLogService,
    private readonly consignments: ConsignmentService,
    private readonly events: ConsignmentEventService,
    private readonly status: ConsignmentStatusService,
    private readonly mutation: StockMutationService,
    private readonly units: StockUnitService,
    private readonly binPolicy: BinPolicyService,
    private readonly warehouses: WarehouseResolverService,
    private readonly numbering: ShipmentNumberingService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
  ) {}

  async dispatchToIndia(
    staffId: string,
    consignmentId: string,
    input: {
      lines: Array<{ lineId: string; quantity: number }>;
      etaAt?: string;
      reference?: string;
    },
    ctx: ClientContext,
  ): Promise<DispatchResult> {
    const consignment = await this.consignments.requireById(consignmentId);
    if (consignment.route !== ConsignmentRoute.VIA_BD) {
      throw new ConflictException({
        code: 'CONSIGNMENT_NOT_VIA_BD',
        message: `${consignment.consignmentNumber} ships straight to India — there is nothing to forward.`,
      });
    }
    if (consignment.cancelledAt !== null) {
      throw new ConflictException({
        code: 'CONSIGNMENT_CANCELLED',
        message: `${consignment.consignmentNumber} was cancelled`,
      });
    }
    const bdLeg = consignment.receipts.find((r) => r.leg === ConsignmentLeg.BD_INTAKE);
    if (!bdLeg) {
      throw new ConflictException({
        code: 'BD_LEG_MISSING',
        message: `${consignment.consignmentNumber} has no Bangladesh intake to dispatch from`,
      });
    }
    if (bdLeg.status !== GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'BD_LEG_NOT_COUNTED',
        message:
          `${consignment.consignmentNumber} has not been counted in Bangladesh yet. ` +
          'Finish receiving it there first — we can only forward what we know we have.',
      });
    }
    // Strict SKUs labelled in Bangladesh must actually be labelled before
    // they leave, or the arrival has nothing to reconcile a shortfall
    // against and the "named missing serials" property is lost.
    if (consignment.labellingSite === LabellingSite.BD && consignment.labelsPrintedAt === null) {
      throw new ConflictException({
        code: 'LABELS_NOT_PRINTED',
        message:
          `${consignment.consignmentNumber} is set to be labelled in Bangladesh and no labels have been printed. ` +
          'Print them before it leaves, or move the labelling station to India.',
      });
    }

    const destWarehouseId = await this.warehouses.getDefaultWarehouseId();
    const byLineId = new Map(bdLeg.lines.map((l) => [l.id, l]));
    for (const req of input.lines) {
      if (!byLineId.has(req.lineId)) {
        throw new BadRequestException({
          code: 'DISPATCH_LINE_UNKNOWN',
          message: `Line ${req.lineId} is not part of this consignment's Bangladesh intake`,
        });
      }
    }

    const result = await this.mutation.runWithRetry(async (tx) => {
      const transitBinId = await this.binPolicy.transitBinId(destWarehouseId, tx);
      const legNumber = await this.numbering.nextShipmentNumber(tx);
      const receiptNumber = `${consignment.consignmentNumber}-${legNumber.slice(-6)}`;

      const legReceipt = await tx.goodsReceipt.create({
        data: {
          sellerId: consignment.sellerId,
          warehouseId: destWarehouseId,
          consignmentId: consignment.id,
          leg: ConsignmentLeg.IN_FINAL,
          receiptNumber,
          status: GoodsReceiptStatus.PENDING,
          dispatchedAt: new Date(),
          dispatchedById: staffId,
          ...(input.etaAt === undefined ? {} : { expectedArrivalAt: new Date(input.etaAt) }),
          sellerReference: input.reference ?? consignment.sellerReference,
        },
        select: { id: true, receiptNumber: true },
      });

      let unitsDispatched = 0;
      const dispatchedLines: Array<{ variantId: string; quantity: number }> = [];

      for (const req of input.lines) {
        const source = byLineId.get(req.lineId);
        if (source === undefined || source.batchId === null) {
          throw new ConflictException({
            code: 'DISPATCH_LINE_NOT_STOCKED',
            message: `Line ${req.lineId} has no batch — it was never booked into stock`,
          });
        }

        // The child batch at the DESTINATION. Deterministic code, so a
        // second dispatch from the same intake line joins the existing
        // child rather than colliding on (sellerId, batchCode).
        const parent = await tx.stockBatch.findUniqueOrThrow({
          where: { id: source.batchId },
          select: {
            batchCode: true,
            manufacturedAt: true,
            expiresAt: true,
            unitCostInr: true,
            unitCostBdt: true,
            receivingNoteId: true,
          },
        });
        const childCode = `${parent.batchCode}-IN`;
        const existingChild = await tx.stockBatch.findUnique({
          where: {
            sellerId_batchCode: { sellerId: consignment.sellerId, batchCode: childCode },
          },
          select: { id: true },
        });
        const childBatchId =
          existingChild?.id ??
          (
            await tx.stockBatch.create({
              data: {
                sellerId: consignment.sellerId,
                variantId: source.variantId,
                warehouseId: destWarehouseId,
                batchCode: childCode,
                manufacturedAt: parent.manufacturedAt,
                expiresAt: parent.expiresAt,
                unitCostInr: parent.unitCostInr,
                unitCostBdt: parent.unitCostBdt,
                initialQty: 0,
                receivedAt: new Date(),
                receivedById: staffId,
                // Points at the INDIA leg, not the Bangladesh parent's
                // receipt: the freight bill is amortised over the units
                // that land, and the attribution walk has to arrive at
                // the leg carrying that bill.
                receivingNoteId: legReceipt.id,
                parentBatchId: source.batchId,
              },
              select: { id: true },
            })
          ).id;
        if (existingChild) {
          await tx.stockBatch.update({
            where: { id: existingChild.id },
            data: { initialQty: { increment: req.quantity } },
          });
        } else {
          await tx.stockBatch.update({
            where: { id: childBatchId },
            data: { initialQty: req.quantity },
          });
        }

        // Where the goods physically are in Bangladesh. The intake's
        // putaway bin is a hint that can be stale, so the authority is
        // the stock level itself.
        const bdLevel = await tx.stockLevel.findFirst({
          where: {
            sellerId: consignment.sellerId,
            variantId: source.variantId,
            warehouseId: bdLeg.warehouseId,
            batchId: source.batchId,
            qtyOnHand: { gte: req.quantity },
          },
          orderBy: { qtyOnHand: 'desc' },
          select: { binId: true, qtyOnHand: true },
        });
        if (!bdLevel) {
          throw new ConflictException({
            code: 'DISPATCH_INSUFFICIENT_STOCK',
            message:
              `Not enough of ${source.variant.skuCode} standing in Bangladesh to send ${req.quantity}. ` +
              'Re-count the intake, or dispatch what is actually there.',
          });
        }

        const transferGroupId = randomUUID();
        await this.mutation.apply(tx, {
          sellerId: consignment.sellerId,
          variantId: source.variantId,
          warehouseId: bdLeg.warehouseId,
          binId: bdLevel.binId,
          batchId: source.batchId,
          qtyChange: -req.quantity,
          type: StockMovementType.TRANSFER_OUT,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reason: `Dispatched to India — ${receiptNumber}`,
          transferGroupId,
          fromBinId: bdLevel.binId,
          toBinId: transitBinId,
        });
        await this.mutation.apply(tx, {
          sellerId: consignment.sellerId,
          variantId: source.variantId,
          warehouseId: destWarehouseId,
          binId: transitBinId,
          batchId: childBatchId,
          qtyChange: req.quantity,
          type: StockMovementType.TRANSFER_IN,
          actorType: ActorType.STAFF,
          actorId: staffId,
          reason: `In transit from Bangladesh — ${receiptNumber}`,
          transferGroupId,
          fromBinId: bdLevel.binId,
          toBinId: transitBinId,
        });

        // The India leg's own line, carrying the child batch so the
        // arrival knows what to move out of TRANSIT.
        await tx.goodsReceiptLine.create({
          data: {
            receiptId: legReceipt.id,
            variantId: source.variantId,
            expectedQty: req.quantity,
            batchId: childBatchId,
            unitCostInr: parent.unitCostInr,
            manufacturedAt: parent.manufacturedAt,
            expiresAt: parent.expiresAt,
          },
        });

        // Serialized units travel with the goods. They were labelled in
        // Bangladesh, so they already exist — they move, they are not
        // re-registered.
        await this.units.moveUnitsForReceiptLine(tx, {
          goodsReceiptLineId: source.id,
          fromStatus: StockUnitStatus.IN_STOCK,
          toStatus: StockUnitStatus.IN_STOCK,
          limit: req.quantity,
          currentBinId: bdLevel.binId,
          warehouseId: destWarehouseId,
          binId: transitBinId,
          batchId: childBatchId,
          gate: 'consignment.dispatch',
          actorType: ActorType.STAFF,
          actorId: staffId,
          note: `Left Bangladesh on ${receiptNumber}`,
        });

        unitsDispatched += req.quantity;
        dispatchedLines.push({ variantId: source.variantId, quantity: req.quantity });
      }

      await tx.goodsReceipt.update({
        where: { id: legReceipt.id },
        data: { status: GoodsReceiptStatus.ARRIVING },
      });

      await this.events.append(
        {
          consignmentId: consignment.id,
          type: ConsignmentEventType.DISPATCHED_TO_IN,
          description: `${unitsDispatched} unit(s) left Bangladesh for India`,
          data: {
            legReceiptId: legReceipt.id,
            legReceiptNumber: legReceipt.receiptNumber,
            unitsDispatched,
            etaAt: input.etaAt ?? null,
            reference: input.reference ?? null,
          },
          actorType: ActorType.STAFF,
          actorId: staffId,
        },
        tx,
      );

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: consignment.sellerId,
          action: 'inventory.consignment.dispatched',
          entityType: 'consignment',
          entityId: consignment.id,
          severity: 'MEDIUM',
          metadata: {
            consignmentNumber: consignment.consignmentNumber,
            legReceiptId: legReceipt.id,
            unitsDispatched,
            lineCount: input.lines.length,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
        tx,
      );

      // "Your stock has left Bangladesh" is the milestone the seller
      // most wants and could not previously see at all.
      const seller = await tx.seller.findUnique({
        where: { id: consignment.sellerId },
        select: { id: true, email: true, companyName: true },
      });
      if (seller) {
        await this.email.enqueue({
          templateCode: 'seller.consignment_dispatched.email',
          recipient: {
            type: NotificationRecipientType.SELLER,
            id: seller.id,
            email: seller.email,
          },
          variables: {
            company_name: seller.companyName,
            consignment_number: consignment.consignmentNumber,
            units_dispatched: unitsDispatched,
            eta_note:
              input.etaAt === undefined
                ? ''
                : ` Expected to arrive ${new Date(input.etaAt).toISOString().slice(0, 10)}.`,
            app_url: this.env.sellerAppUrl,
          },
          triggerEvent: 'inventory.consignment_dispatched',
        });
      }

      return {
        legReceiptId: legReceipt.id,
        legReceiptNumber: legReceipt.receiptNumber,
        unitsDispatched,
        lines: dispatchedLines,
      };
    });

    // Derived from where the stock now sits, so it has to run after the
    // transfers commit.
    await this.status.recompute(consignmentId);
    this.logger.log(
      { consignmentId, legReceiptId: result.legReceiptId, units: result.unitsDispatched },
      'Consignment leg dispatched to India',
    );
    return result;
  }
}
