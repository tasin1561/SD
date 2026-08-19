import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  GoodsReceiptStatus,
  LabellingSite,
  Prisma,
  StockMovementType,
  StockUnitStatus,
} from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  /**
   * Forward the consignment from Bangladesh WITHOUT counting it.
   *
   * Nothing was ever booked into stock in Dhaka, so there is nothing to
   * transfer: no movements, no batches, no TRANSIT bin. The India leg is
   * created from the seller's DECLARED quantities and behaves exactly
   * like a direct arrival — its lines carry no batch, which is what makes
   * the arrival take the ordinary RECEIVING path and create stock rather
   * than move it out of transit.
   *
   * The Bangladesh leg is closed and flagged. It is NOT completed with
   * zeroes: a count of zero is a warehouse that opened the carton and
   * found nothing, and rendering that here would invent a 300-unit
   * shortfall out of a decision not to look.
   */
  private async forwardWithoutCounting(
    staffId: string,
    consignment: Awaited<ReturnType<ConsignmentService['requireById']>>,
    bdLeg: Awaited<ReturnType<ConsignmentService['requireById']>>['receipts'][number],
    input: { etaAt?: string | undefined; reference?: string | undefined },
    ctx: ClientContext,
  ): Promise<DispatchResult> {
    if (bdLeg.status === GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'BD_LEG_ALREADY_COUNTED',
        message:
          `${consignment.consignmentNumber} has already been counted in Bangladesh. ` +
          'Dispatch the counted quantities instead — the count is the better number.',
      });
    }
    if (consignment.labellingSite === LabellingSite.BD) {
      throw new ConflictException({
        code: 'LABELLING_NEEDS_A_COUNT',
        message:
          `${consignment.consignmentNumber} is set to be labelled in Bangladesh, which cannot ` +
          'happen without opening it. Count it there, or move the labelling station to India.',
      });
    }

    const destWarehouseId = await this.warehouses.getDefaultWarehouseId();

    const result = await this.prisma.client.$transaction(async (tx: Prisma.TransactionClient) => {
      const legNumber = await this.numbering.nextShipmentNumber(tx);
      const receiptNumber = `${consignment.consignmentNumber}-${legNumber.slice(-6)}`;
      const legReceipt = await tx.goodsReceipt.create({
        data: {
          sellerId: consignment.sellerId,
          warehouseId: destWarehouseId,
          consignmentId: consignment.id,
          leg: ConsignmentLeg.IN_FINAL,
          receiptNumber,
          status: GoodsReceiptStatus.ARRIVING,
          dispatchedAt: new Date(),
          dispatchedById: staffId,
          ...(input.etaAt === undefined ? {} : { expectedArrivalAt: new Date(input.etaAt) }),
          sellerReference: input.reference ?? consignment.sellerReference,
        },
        select: { id: true, receiptNumber: true },
      });

      let units = 0;
      for (const line of bdLeg.lines) {
        // batchId stays NULL — there is no Bangladesh batch to carry
        // across, and its absence is exactly what routes the arrival
        // through the ordinary RECEIVING path.
        await tx.goodsReceiptLine.create({
          data: {
            receiptId: legReceipt.id,
            variantId: line.variantId,
            expectedQty: line.expectedQty,
          },
        });
        units += line.expectedQty;
      }

      await tx.goodsReceipt.update({
        where: { id: bdLeg.id },
        data: {
          status: GoodsReceiptStatus.COMPLETED,
          forwardedWithoutCount: true,
          receivedAt: new Date(),
          receivedById: staffId,
          discrepancyNotes:
            'Handled in Bangladesh and sent on without opening. India is the first count.',
        },
      });

      await this.events.append(
        {
          consignmentId: consignment.id,
          type: ConsignmentEventType.DISPATCHED_TO_IN,
          description: `Sent on to India without counting — ${units} declared unit(s)`,
          data: {
            legReceiptId: legReceipt.id,
            legReceiptNumber: legReceipt.receiptNumber,
            withoutCounting: true,
            declaredUnits: units,
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
          action: 'inventory.consignment.forwarded_without_count',
          entityType: 'consignment',
          entityId: consignment.id,
          severity: 'MEDIUM',
          metadata: {
            consignmentNumber: consignment.consignmentNumber,
            legReceiptId: legReceipt.id,
            declaredUnits: units,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
        tx,
      );

      return {
        legReceiptId: legReceipt.id,
        legReceiptNumber: legReceipt.receiptNumber,
        unitsDispatched: units,
        lines: bdLeg.lines.map((l) => ({ variantId: l.variantId, quantity: l.expectedQty })),
      };
    });

    await this.status.recompute(consignment.id);
    this.logger.log(
      { consignmentId: consignment.id, legReceiptId: result.legReceiptId },
      'Consignment forwarded from Bangladesh without counting',
    );
    return result;
  }

  async dispatchToIndia(
    staffId: string,
    consignmentId: string,
    input: {
      lines?: Array<{ lineId: string; quantity: number }> | undefined;
      etaAt?: string | undefined;
      reference?: string | undefined;
      /** Send it on WITHOUT opening it — see `forwardWithoutCounting`. */
      withoutCounting?: boolean | undefined;
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
    // Sending it on WITHOUT opening it. A sealed carton going straight to
    // India can travel on the seller's declared quantities and be counted
    // once, when it lands — counting it twice is hours the Dhaka bench
    // may not have. It is a deliberate choice, never a fallback for a
    // count somebody forgot, which is why it takes its own flag rather
    // than happening whenever the leg is uncounted.
    if (input.withoutCounting === true) {
      return this.forwardWithoutCounting(staffId, consignment, bdLeg, input, ctx);
    }

    if (bdLeg.status !== GoodsReceiptStatus.COMPLETED) {
      throw new ConflictException({
        code: 'BD_LEG_NOT_COUNTED',
        message:
          `${consignment.consignmentNumber} has not been counted in Bangladesh yet. ` +
          'Finish receiving it there, or send it on without counting — but say which.',
      });
    }
    const requestedLines = input.lines ?? [];
    if (requestedLines.length === 0) {
      throw new BadRequestException({
        code: 'DISPATCH_NOTHING_SELECTED',
        message: 'Choose how many of each product are leaving on this shipment.',
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
    for (const req of requestedLines) {
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

      for (const req of requestedLines) {
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
            lineCount: requestedLines.length,
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
