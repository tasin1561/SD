import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  ConsignmentStatus,
  GoodsReceiptStatus,
  LabellingSite,
  Prisma,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import { ConsignmentNumberingService } from '../../consignment-core/services/consignment-numbering.service';
import { ConsignmentStatusService } from '../../consignment-core/services/consignment-status.service';
import { GoodsReceiptService } from '../../inventory-receipt/services/goods-receipt.service';
import { WarehouseResolverService } from '../../inventory-shared/warehouse-resolver.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

const CONSIGNMENT_INCLUDE = {
  seller: { select: { id: true, companyName: true, emailDisplay: true } },
  receipts: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      receiptNumber: true,
      leg: true,
      status: true,
      warehouseId: true,
      dispatchedAt: true,
      forwardedWithoutCount: true,
      receivedAt: true,
      hasDiscrepancies: true,
      discrepancyNotes: true,
      warehouse: { select: { id: true, code: true, name: true, countryCode: true } },
      lines: {
        select: {
          id: true,
          variantId: true,
          expectedQty: true,
          receivedQty: true,
          damagedQty: true,
          batchId: true,
          variant: {
            select: {
              skuCode: true,
              variantLabel: true,
              product: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  // A consignment carries one freight bill PER ARRIVAL, not one overall
  // — a shipment that lands in September is invoiced separately from one
  // that landed in August.
  freightCharges: {
    select: { id: true, status: true, totalInr: true, goodsReceiptId: true },
  },
} satisfies Prisma.ConsignmentInclude;

export type ConsignmentView = Prisma.ConsignmentGetPayload<{
  include: typeof CONSIGNMENT_INCLUDE;
}>;

/**
 * A consignment — the seller's stock journey, from announcement to
 * landed-in-India.
 *
 * This service owns the JOURNEY: the route, the labelling station, the
 * cancel window and the timeline. It owns none of the counting — each
 * stop is an ordinary `GoodsReceipt` and reuses the receiving station
 * unchanged, which is the entire reason the two-leg flow needed no new
 * counting code.
 *
 * See docs/consignment-two-leg.md.
 */
@Injectable()
export class ConsignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly numbering: ConsignmentNumberingService,
    private readonly events: ConsignmentEventService,
    private readonly status: ConsignmentStatusService,
    private readonly receipts: GoodsReceiptService,
    private readonly warehouses: WarehouseResolverService,
  ) {}

  /**
   * The seller announces stock and says where they are sending it.
   *
   * Creates the consignment plus its FIRST leg — a BD intake for VIA_BD,
   * the India arrival itself for DIRECT_IN. The leg is a normal goods
   * receipt, so the warehouse can start counting the moment the parcel
   * lands with no further setup.
   */
  async declare(
    sellerId: string,
    input: {
      route: ConsignmentRoute;
      expectedArrivalAt?: string;
      sellerReference?: string;
      lines: Array<{
        variantId: string;
        expectedQty: number;
        unitCostInr?: number;
        manufacturedAt?: string;
        expiresAt?: string;
      }>;
    },
    ctx: ClientContext,
  ): Promise<ConsignmentView> {
    // Resolved BEFORE anything is written. A VIA_BD declaration with no
    // Bangladesh warehouse configured must fail with nothing created,
    // rather than leaving a consignment that can never take a leg.
    const warehouseId =
      input.route === ConsignmentRoute.VIA_BD
        ? await this.warehouses.getBdIntakeWarehouseId()
        : await this.warehouses.getDefaultWarehouseId();

    // Validate the LINES before the consignment row exists, for the same
    // reason as the warehouse above. The consignment is created in its own
    // committed transaction and the leg is declared afterwards, so a bad
    // variant id discovered later would leave an orphan consignment with
    // no leg — a row the panel cannot render and nobody can act on.
    await this.receipts.assertVariants(sellerId, input.lines);

    const consignmentId = await this.prisma.client.$transaction(async (tx) => {
      const number = await this.numbering.nextConsignmentNumber(tx);
      const row = await tx.consignment.create({
        data: {
          sellerId,
          consignmentNumber: number,
          route: input.route,
          status: ConsignmentStatus.PENDING,
          ...(input.expectedArrivalAt === undefined
            ? {}
            : { expectedArrivalAt: new Date(input.expectedArrivalAt) }),
          sellerReference: input.sellerReference ?? null,
        },
        select: { id: true, consignmentNumber: true },
      });
      await this.events.append(
        {
          consignmentId: row.id,
          type: ConsignmentEventType.DECLARED,
          description:
            input.route === ConsignmentRoute.VIA_BD
              ? `Announced — ${input.lines.length} product(s) heading to our Bangladesh warehouse`
              : `Announced — ${input.lines.length} product(s) heading straight to India`,
          data: { route: input.route, lineCount: input.lines.length },
          actorType: ActorType.SELLER,
          actorId: sellerId,
        },
        tx,
      );
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'inventory.consignment.declared',
          entityType: 'consignment',
          entityId: row.id,
          metadata: {
            consignmentNumber: row.consignmentNumber,
            route: input.route,
            warehouseId,
            lineCount: input.lines.length,
          },
        },
        tx,
      );
      return row.id;
    });

    // The leg is created through the receipt service so declaration
    // validation (archived variants, ownership, line shape) stays in ONE
    // place rather than being re-implemented here.
    const leg = await this.receipts.declare(
      sellerId,
      {
        warehouseId,
        ...(input.expectedArrivalAt === undefined
          ? {}
          : { expectedArrivalAt: input.expectedArrivalAt }),
        ...(input.sellerReference === undefined ? {} : { sellerReference: input.sellerReference }),
        lines: input.lines,
      },
      ctx,
    );
    await this.prisma.client.goodsReceipt.update({
      where: { id: leg.id },
      data: {
        consignmentId,
        leg:
          input.route === ConsignmentRoute.VIA_BD
            ? ConsignmentLeg.BD_INTAKE
            : ConsignmentLeg.IN_FINAL,
      },
    });

    return this.requireById(consignmentId);
  }

  async listForSeller(
    sellerId: string,
    query: {
      status?: ConsignmentStatus;
      route?: ConsignmentRoute;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ items: ConsignmentView[]; total: number; page: number; pageSize: number }> {
    return this.list({ ...query, sellerId });
  }

  async list(query: {
    sellerId?: string;
    status?: ConsignmentStatus;
    route?: ConsignmentRoute;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: ConsignmentView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ConsignmentWhereInput = { deletedAt: null };
    if (query.sellerId) where.sellerId = query.sellerId;
    if (query.status) where.status = query.status;
    if (query.route) where.route = query.route;

    const [items, total] = await Promise.all([
      this.prisma.client.consignment.findMany({
        where,
        include: CONSIGNMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.consignment.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getForSeller(sellerId: string, id: string): Promise<ConsignmentView> {
    const row = await this.requireById(id);
    if (row.sellerId !== sellerId) {
      // Same generic 404 as a genuine miss — a distinguishable 403 would
      // confirm the consignment exists to somebody who does not own it.
      throw new NotFoundException({
        code: 'CONSIGNMENT_NOT_FOUND',
        message: 'Consignment not found',
      });
    }
    return row;
  }

  async requireById(id: string): Promise<ConsignmentView> {
    const row = await this.prisma.client.consignment.findFirst({
      where: { id, deletedAt: null },
      include: CONSIGNMENT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CONSIGNMENT_NOT_FOUND',
        message: 'Consignment not found',
      });
    }
    return row;
  }

  /**
   * Ops chooses where the barcode labels get printed.
   *
   * Free to change until the first label is printed, then locked. A
   * consignment half-labelled in Dhaka and half in Bangalore has no
   * recovery: the units that were labelled cannot be told apart from the
   * ones that were not without opening every carton.
   */
  async setLabellingSite(
    staffId: string,
    id: string,
    site: LabellingSite,
    ctx: ClientContext,
  ): Promise<ConsignmentView> {
    const row = await this.requireById(id);
    if (row.labelsPrintedAt !== null) {
      throw new ConflictException({
        code: 'LABELLING_SITE_LOCKED',
        message:
          `Labels for ${row.consignmentNumber} were already printed at ${row.labellingSite}. ` +
          'Moving the station now would leave part of the consignment labelled and part not.',
      });
    }
    if (site === LabellingSite.BD && row.route !== ConsignmentRoute.VIA_BD) {
      throw new ConflictException({
        code: 'LABELLING_SITE_UNREACHABLE',
        message: `${row.consignmentNumber} never passes through Bangladesh, so it cannot be labelled there.`,
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.consignment.update({ where: { id }, data: { labellingSite: site } });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: row.sellerId,
          action: 'inventory.consignment.labelling_site_set',
          entityType: 'consignment',
          entityId: id,
          metadata: { from: row.labellingSite, to: site, ...ctxMeta(ctx) },
        },
        tx,
      );
    });
    return this.requireById(id);
  }

  /**
   * The goods are abandoned and go back to the seller.
   *
   * The window CLOSES at dispatch, and that is what keeps this flow
   * finite rather than a policy preference to be relaxed later.
   * Cancelling mid-air would force answers to three questions that
   * currently have none: who eats freight already spent, where stock
   * standing in a TRANSIT bin goes back to, and what happens when a
   * parcel lands in Bangalore against a consignment that no longer
   * exists. Refusing here means none of those states is reachable.
   *
   * Stock already booked in at the intake is removed by
   * `ConsignmentCancelService`; this method owns the guard and the record.
   */
  async assertCancellable(row: ConsignmentView): Promise<void> {
    if (row.status === ConsignmentStatus.CANCELLED) {
      throw new ConflictException({
        code: 'CONSIGNMENT_ALREADY_CANCELLED',
        message: `${row.consignmentNumber} is already cancelled`,
      });
    }
    const dispatched = row.receipts.some((r) => r.dispatchedAt !== null);
    if (dispatched) {
      throw new ConflictException({
        code: 'CONSIGNMENT_ALREADY_DISPATCHED',
        message:
          `${row.consignmentNumber} has already left for India and cannot be cancelled. ` +
          'Receive it, then use a stock adjustment or a return if the goods must go back.',
      });
    }
    const landed = row.receipts.some(
      (r) => r.leg === ConsignmentLeg.IN_FINAL && r.status === GoodsReceiptStatus.COMPLETED,
    );
    if (landed) {
      throw new ConflictException({
        code: 'CONSIGNMENT_ALREADY_ARRIVED',
        message: `${row.consignmentNumber} has already arrived in India and cannot be cancelled.`,
      });
    }
  }

  /** Recompute after anything that could have moved the journey on. */
  async refreshStatus(id: string): Promise<ConsignmentStatus> {
    return this.status.recompute(id);
  }
}

function ctxMeta(ctx: ClientContext): Record<string, unknown> {
  return { ipAddress: ctx.ipAddress ?? null, userAgent: ctx.userAgent ?? null };
}
