import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  Prisma,
  StockMovementReasonCode,
  StockMovementType,
  StockUnitStatus,
} from '@skydrop/db';
import { randomUUID } from 'node:crypto';
import { StockMutationService } from '../../inventory-shared/stock-mutation.service';
import { StockUnitService } from '../../inventory-shared/stock-unit.service';

export interface ArrivalLineInput {
  readonly sellerId: string;
  readonly variantId: string;
  readonly warehouseId: string;
  readonly goodsReceiptLineId: string;
  /** The batch the dispatch parked in TRANSIT. Already at this warehouse. */
  readonly batchId: string;
  readonly transitBinId: string;
  readonly putawayBinId: string;
  readonly receivedQty: number;
  readonly staffId: string;
  readonly receiptNumber: string;
  readonly strict: boolean;
}

export interface ArrivalLineResult {
  readonly moved: number;
  readonly lost: number;
  readonly surplus: number;
  /** Strict mode only — the serials that never turned up. */
  readonly lostSerials: readonly string[];
}

/**
 * Receiving a leg that we DISPATCHED to ourselves.
 *
 * A normal goods receipt CREATES stock — a `RECEIVING` movement against a
 * batch that did not exist a moment ago. An arrival from our own
 * Bangladesh warehouse must not: the stock already exists, sitting in
 * this warehouse's TRANSIT bin since dispatch. Posting RECEIVING here
 * would double it, and the second copy would be sellable.
 *
 * So an arrival is a TRANSFER out of TRANSIT plus the variance:
 *
 *   moved   = min(received, in transit)  TRANSIT -> putaway bin
 *   lost    = in transit - moved         ADJUSTMENT_DECREASE, IN_TRANSIT_LOSS
 *   surplus = received - moved           ADJUSTMENT_INCREASE, IN_TRANSIT_SURPLUS
 *
 * Both variances are RECORDED, never reconciled away. The Bangladesh
 * count was a real observation of goods that really were there; India is
 * final because it is the count that decides what can be sold, not
 * because the earlier number was wrong. A shortfall is our dispute with
 * the forwarder and a surplus is goods we did not know we had — each is
 * a fact worth being able to total at the end of a month, which silently
 * overwriting the earlier count would destroy.
 *
 * Runs INSIDE the caller's transaction (the receipt-completion tx), so
 * the movements, the unit ledger and the receipt status commit together.
 */
@Injectable()
export class TransitArrivalService {
  private readonly logger = new Logger(TransitArrivalService.name);

  constructor(
    private readonly mutation: StockMutationService,
    private readonly units: StockUnitService,
  ) {}

  async writeArrivalLine(
    tx: Prisma.TransactionClient,
    input: ArrivalLineInput,
  ): Promise<ArrivalLineResult> {
    const level = await tx.stockLevel.findUnique({
      where: {
        sellerId_variantId_warehouseId_binId_batchId: {
          sellerId: input.sellerId,
          variantId: input.variantId,
          warehouseId: input.warehouseId,
          binId: input.transitBinId,
          batchId: input.batchId,
        },
      },
      select: { qtyOnHand: true },
    });
    const inTransit = level?.qtyOnHand ?? 0;
    const moved = Math.min(input.receivedQty, inTransit);
    const lost = inTransit - moved;
    const surplus = input.receivedQty - moved;

    if (moved > 0) {
      const transferGroupId = randomUUID();
      await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: input.transitBinId,
        batchId: input.batchId,
        qtyChange: -moved,
        type: StockMovementType.TRANSFER_OUT,
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        reason: `Arrived and counted — ${input.receiptNumber}`,
        transferGroupId,
        fromBinId: input.transitBinId,
        toBinId: input.putawayBinId,
      });
      await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: input.putawayBinId,
        batchId: input.batchId,
        qtyChange: moved,
        type: StockMovementType.TRANSFER_IN,
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        reason: `Arrived and counted — ${input.receiptNumber}`,
        transferGroupId,
        fromBinId: input.transitBinId,
        toBinId: input.putawayBinId,
      });
    }

    if (lost > 0) {
      await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: input.transitBinId,
        batchId: input.batchId,
        qtyChange: -lost,
        type: StockMovementType.ADJUSTMENT_DECREASE,
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        reasonCode: StockMovementReasonCode.IN_TRANSIT_LOSS,
        reason: `Dispatched ${inTransit}, counted ${input.receivedQty} on arrival — ${input.receiptNumber}`,
      });
    }

    if (surplus > 0) {
      await this.mutation.apply(tx, {
        sellerId: input.sellerId,
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        binId: input.putawayBinId,
        batchId: input.batchId,
        qtyChange: surplus,
        type: StockMovementType.ADJUSTMENT_INCREASE,
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        reasonCode: StockMovementReasonCode.IN_TRANSIT_SURPLUS,
        reason: `Dispatched ${inTransit}, counted ${input.receivedQty} on arrival — ${input.receiptNumber}`,
      });
    }

    let lostSerials: readonly string[] = [];
    if (input.strict) {
      // The units that DID arrive move out of transit onto the shelf.
      await this.units.moveUnitsForReceiptLine(tx, {
        goodsReceiptLineId: input.goodsReceiptLineId,
        fromStatus: StockUnitStatus.IN_STOCK,
        toStatus: StockUnitStatus.IN_STOCK,
        limit: moved,
        currentBinId: input.transitBinId,
        binId: input.putawayBinId,
        gate: 'consignment.arrival',
        actorType: ActorType.STAFF,
        actorId: input.staffId,
        note: `Arrived at ${input.receiptNumber}`,
      });
      // Whatever is still standing in transit never turned up. This is
      // the strongest version of the count: not "we are three short"
      // but three named serials that left Bangladesh and did not land.
      if (lost > 0) {
        lostSerials = await this.units.moveUnitsForReceiptLine(tx, {
          goodsReceiptLineId: input.goodsReceiptLineId,
          fromStatus: StockUnitStatus.IN_STOCK,
          toStatus: StockUnitStatus.LOST,
          limit: lost,
          currentBinId: input.transitBinId,
          writeOffReason: 'IN_TRANSIT_LOSS',
          gate: 'consignment.arrival',
          actorType: ActorType.STAFF,
          actorId: input.staffId,
          note: `Dispatched but never arrived — ${input.receiptNumber}`,
        });
        this.logger.warn(
          {
            receiptLineId: input.goodsReceiptLineId,
            lost,
            serials: lostSerials,
          },
          'Serialized units dispatched from Bangladesh did not arrive in India',
        );
      }
    }

    return { moved, lost, surplus, lostSerials };
  }
}
