import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ConsignmentService } from './consignment.service';

export interface AssistantConsignmentLeg {
  readonly receiptNumber: string;
  /** `BD_INTAKE` (Dhaka) or `IN_FINAL` (India). */
  readonly leg: string | null;
  readonly status: string;
  readonly warehouse: string;
  readonly country: string | null;
  readonly dispatchedAt: string | null;
  readonly receivedAt: string | null;
  readonly hasDiscrepancies: boolean;
  readonly lines: ReadonlyArray<{
    readonly sku: string;
    readonly name: string;
    readonly expectedQty: number;
    readonly receivedQty: number;
    readonly damagedQty: number;
  }>;
}

export interface AssistantConsignment {
  readonly consignmentNumber: string;
  readonly status: string;
  readonly route: string;
  readonly sellerReference: string | null;
  readonly expectedArrivalAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly legs: readonly AssistantConsignmentLeg[];
}

/**
 * What the assistant may read about one of the client's consignments: its
 * status and its legs, nothing else.
 *
 * Read-only, and it reuses `ConsignmentService.getForSeller` — the call the
 * seller route makes, which re-checks ownership — after resolving the NUMBER
 * to an id with the seller id in the `where`. The freight bills that
 * `ConsignmentView` carries are money and are not copied; `status` is read
 * as stored (CNS-6 — it is derived by `ConsignmentStatusService`, never set
 * here).
 */
@Injectable()
export class ConsignmentAssistantReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consignments: ConsignmentService,
  ) {}

  async forSeller(sellerId: string, number: string): Promise<AssistantConsignment | null> {
    const found = await this.prisma.client.consignment.findFirst({
      where: {
        sellerId,
        deletedAt: null,
        consignmentNumber: { equals: number.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (found === null) return null;
    const c = await this.consignments.getForSeller(sellerId, found.id);
    return {
      consignmentNumber: c.consignmentNumber,
      status: String(c.status),
      route: String(c.route),
      sellerReference: c.sellerReference,
      expectedArrivalAt: c.expectedArrivalAt?.toISOString() ?? null,
      cancelledAt: c.cancelledAt?.toISOString() ?? null,
      cancelReason: c.cancelReason,
      legs: c.receipts.map((r) => ({
        receiptNumber: r.receiptNumber,
        leg: r.leg === null ? null : String(r.leg),
        status: String(r.status),
        warehouse: r.warehouse.name,
        country: r.warehouse.countryCode,
        dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
        receivedAt: r.receivedAt?.toISOString() ?? null,
        hasDiscrepancies: r.hasDiscrepancies,
        lines: r.lines.map((l) => ({
          sku: l.variant.skuCode,
          name: l.variant.product.name,
          expectedQty: l.expectedQty,
          receivedQty: l.receivedQty,
          damagedQty: l.damagedQty,
        })),
      })),
    };
  }
}
