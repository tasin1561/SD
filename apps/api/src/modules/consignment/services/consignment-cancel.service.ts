import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ConsignmentEventType,
  ConsignmentStatus,
  GoodsReceiptStatus,
  StockMovementReasonCode,
  StockMovementType,
  StockUnitStatus,
} from '@skydrop/db';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { ConsignmentStatusService } from '../../consignment-core/services/consignment-status.service';
import { StockCacheService } from '../../inventory-shared/stock-cache.service';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';
import { ConsignmentService } from './consignment.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { EnvService } from '../../../config/env.service';
import { NotificationRecipientType } from '@skydrop/db';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface CancelResult {
  readonly unitsReturned: number;
  readonly serialsReturned: number;
}

/**
 * The consignment is abandoned and the goods go home.
 *
 * Cancel used to be PENDING-only and moved no stock, which was correct
 * while a consignment was a single arrival: nothing had been booked in
 * yet. A Bangladesh intake changes that — the goods were counted, they
 * are on our shelves, and sending them back has to remove them.
 *
 * They leave as an `ADJUSTMENT_DECREASE` carrying `RETURNED_TO_SELLER`,
 * NOT a write-off. Nothing was destroyed and somebody has them; "how
 * much did we send back this quarter" is a different question from "how
 * much did we lose", and a shared reason code cannot answer either.
 * Serialized units take the matching `RETURNED_TO_SELLER` status for the
 * same reason — it is neither `WRITTEN_OFF` nor `LOST`.
 *
 * The WINDOW closes at dispatch (`ConsignmentService.assertCancellable`).
 */
@Injectable()
export class ConsignmentCancelService {
  private readonly logger = new Logger(ConsignmentCancelService.name);

  constructor(
    private readonly audit: AuditLogService,
    private readonly consignments: ConsignmentService,
    private readonly events: ConsignmentEventService,
    private readonly status: ConsignmentStatusService,
    private readonly mutation: StockMutationService,
    private readonly units: StockUnitService,
    private readonly cache: StockCacheService,
    private readonly email: EmailQueue,
    private readonly env: EnvService,
  ) {}

  async cancel(
    actor: { readonly staffId?: string; readonly sellerId?: string },
    consignmentId: string,
    reason: string,
    ctx: ClientContext,
  ): Promise<CancelResult> {
    const consignment = await this.consignments.requireById(consignmentId);
    await this.consignments.assertCancellable(consignment);

    const actorType = actor.staffId !== undefined ? ActorType.STAFF : ActorType.SELLER;
    const actorId = actor.staffId ?? actor.sellerId ?? null;
    const touched = new Set<string>();

    const result = await this.mutation.runWithRetry(async (tx) => {
      let unitsReturned = 0;
      let serialsReturned = 0;

      for (const leg of consignment.receipts) {
        // Only a leg that actually booked stock in has anything to give
        // back. A PENDING leg never wrote a movement.
        if (leg.status !== GoodsReceiptStatus.COMPLETED) continue;

        for (const line of leg.lines) {
          if (line.batchId === null) continue;
          const levels = await tx.stockLevel.findMany({
            where: {
              sellerId: consignment.sellerId,
              variantId: line.variantId,
              warehouseId: leg.warehouseId,
              batchId: line.batchId,
              qtyOnHand: { gt: 0 },
            },
            select: { binId: true, qtyOnHand: true },
          });
          for (const level of levels) {
            await this.mutation.apply(tx, {
              sellerId: consignment.sellerId,
              variantId: line.variantId,
              warehouseId: leg.warehouseId,
              binId: level.binId,
              batchId: line.batchId,
              qtyChange: -level.qtyOnHand,
              type: StockMovementType.ADJUSTMENT_DECREASE,
              actorType,
              actorId,
              reasonCode: StockMovementReasonCode.RETURNED_TO_SELLER,
              reason: `Consignment ${consignment.consignmentNumber} cancelled — goods returned to seller`,
            });
            unitsReturned += level.qtyOnHand;
            touched.add(`${leg.warehouseId}:${line.variantId}`);
          }

          const serials = await this.units.moveUnitsForReceiptLine(tx, {
            goodsReceiptLineId: line.id,
            fromStatus: StockUnitStatus.IN_STOCK,
            toStatus: StockUnitStatus.RETURNED_TO_SELLER,
            // Every unit still on the shelf. There is no partial return
            // here — the whole consignment is going back.
            limit: Number.MAX_SAFE_INTEGER,
            writeOffReason: 'CONSIGNMENT_CANCELLED',
            gate: 'consignment.cancel',
            actorType,
            actorId,
            note: `Consignment ${consignment.consignmentNumber} cancelled`,
          });
          serialsReturned += serials.length;
        }

        await tx.goodsReceipt.update({
          where: { id: leg.id },
          data: { status: GoodsReceiptStatus.CANCELLED },
        });
      }

      // Any leg that never got counted is simply closed.
      await tx.goodsReceipt.updateMany({
        where: { consignmentId: consignment.id, status: { not: GoodsReceiptStatus.CANCELLED } },
        data: { status: GoodsReceiptStatus.CANCELLED },
      });

      await tx.consignment.update({
        where: { id: consignment.id },
        data: {
          status: ConsignmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      });

      await this.events.append(
        {
          consignmentId: consignment.id,
          type: ConsignmentEventType.CANCELLED,
          description:
            unitsReturned > 0
              ? `Cancelled — ${unitsReturned} unit(s) going back to you`
              : 'Cancelled before anything arrived',
          data: { reason, unitsReturned, serialsReturned },
          actorType,
          actorId,
        },
        tx,
      );

      await this.audit.log(
        {
          actorType,
          ...(actor.staffId === undefined ? {} : { staffUserId: actor.staffId }),
          sellerId: consignment.sellerId,
          action: 'inventory.consignment.cancelled',
          entityType: 'consignment',
          entityId: consignment.id,
          severity: 'MEDIUM',
          metadata: {
            consignmentNumber: consignment.consignmentNumber,
            reason,
            unitsReturned,
            serialsReturned,
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
        tx,
      );

      const seller = await tx.seller.findUnique({
        where: { id: consignment.sellerId },
        select: { id: true, email: true, companyName: true },
      });
      if (seller) {
        await this.email.enqueue({
          templateCode: 'seller.consignment_cancelled.email',
          recipient: {
            type: NotificationRecipientType.SELLER,
            id: seller.id,
            email: seller.email,
          },
          variables: {
            company_name: seller.companyName,
            consignment_number: consignment.consignmentNumber,
            units_returned: unitsReturned,
            reason,
            support_email: this.env.supportEmail,
          },
          triggerEvent: 'inventory.consignment_cancelled',
        });
      }

      return { unitsReturned, serialsReturned };
    });

    // INV-5: after commit, never inside the stock tx.
    for (const key of touched) {
      const [warehouseId] = key.split(':');
      if (warehouseId !== undefined) {
        await this.cache.invalidate(consignment.sellerId, warehouseId);
      }
    }
    await this.status.recompute(consignmentId);
    this.logger.log(
      { consignmentId, ...result },
      'Consignment cancelled — goods returned to seller',
    );
    return result;
  }
}
