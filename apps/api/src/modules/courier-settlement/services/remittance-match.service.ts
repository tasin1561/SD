import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RemittanceParserRegistry } from './remittance-parser.service';

export interface MatchedRemittanceRow {
  readonly line: number;
  readonly awbNumber: string;
  readonly settledInr: string;
  readonly codAmountInr: string | null;
  readonly status: string | null;
  readonly externalRef: string | null;
  /** Null when we cannot place this waybill. */
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  /** What we expected for that order, so a shortfall is visible before recording. */
  readonly expectedInr: string | null;
  readonly sellerName: string | null;
  /** Why it cannot be allocated, in words an operator can act on. */
  readonly problem: string | null;
  /** Already settled on an earlier payout — allocating again would double-pay. */
  readonly alreadySettled: boolean;
}

export interface RemittancePreview {
  readonly rows: readonly MatchedRemittanceRow[];
  readonly matchedCount: number;
  readonly unmatchedCount: number;
  readonly alreadySettledCount: number;
  /** Sum of the lines that CAN be allocated. */
  readonly allocatableInr: string;
  /** Sum of every line in the file, including the ones we cannot place. */
  readonly fileTotalInr: string;
}

/**
 * Turn a courier's remittance file into an allocation the operator can
 * check before any money moves.
 *
 * Read-only by construction: nothing here writes. The point is that the
 * "ten orders arrived, eight are recognised" case stops being something
 * discovered afterwards in a float report and becomes two numbers on
 * the screen BEFORE the payout is recorded.
 *
 * Matching is on the WAYBILL, which is the identifier both sides agree
 * on. The file's own "Order Number" is the seller's free-text name for
 * the parcel and is shown but never matched.
 */
@Injectable()
export class RemittanceMatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parsers: RemittanceParserRegistry,
  ) {}

  async preview(courierCode: string, csvText: string): Promise<RemittancePreview> {
    const parsed = this.parsers.parse(courierCode, csvText);
    const awbs = parsed.map((r) => r.awbNumber);

    const shipments = await this.prisma.client.shipment.findMany({
      where: { awbNumber: { in: awbs }, deletedAt: null },
      select: {
        awbNumber: true,
        orderShipments: {
          select: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                codAmountInr: true,
                seller: { select: { companyName: true } },
              },
            },
          },
        },
      },
    });
    const byAwb = new Map(shipments.map((s) => [s.awbNumber ?? '', s]));

    // Which of these orders have already been paid on some earlier
    // payout. Allocating one twice would credit the seller twice, and
    // the ledger is append-only, so the error would be permanent.
    const orderIds = shipments
      .flatMap((s) => s.orderShipments.map((os) => os.order.id))
      .filter((id): id is string => id !== undefined);
    const settledLines =
      orderIds.length === 0
        ? []
        : await this.prisma.client.courierSettlementLine.findMany({
            where: { orderId: { in: orderIds } },
            select: { orderId: true },
          });
    const alreadySettled = new Set(settledLines.map((l) => l.orderId));

    let allocatable = new Prisma.Decimal(0);
    let fileTotal = new Prisma.Decimal(0);
    const rows: MatchedRemittanceRow[] = parsed.map((r) => {
      const amount = this.money(r.settledInr);
      if (amount !== null) fileTotal = fileTotal.add(amount);

      const ship = byAwb.get(r.awbNumber) ?? null;
      const order = ship?.orderShipments[0]?.order ?? null;

      let problem: string | null = null;
      if (amount === null) problem = `'${r.settledInr}' is not an amount`;
      else if (amount.lte(0)) problem = 'Nothing payable on this line';
      else if (ship === null) problem = 'No shipment with this waybill';
      else if (order === null) problem = 'Waybill found, but it is not attached to an order';

      const settledAlready = order !== null && alreadySettled.has(order.id);
      if (problem === null && settledAlready) problem = 'Already settled on an earlier payout';

      if (problem === null && amount !== null) allocatable = allocatable.add(amount);

      return {
        line: r.line,
        awbNumber: r.awbNumber,
        settledInr: amount?.toFixed(2) ?? r.settledInr,
        codAmountInr: this.money(r.codAmountInr ?? '')?.toFixed(2) ?? null,
        status: r.status,
        externalRef: r.externalRef,
        orderId: order?.id ?? null,
        orderNumber: order?.orderNumber ?? null,
        expectedInr: order?.codAmountInr?.toFixed(2) ?? null,
        sellerName: order?.seller.companyName ?? null,
        problem,
        alreadySettled: settledAlready,
      };
    });

    return {
      rows,
      matchedCount: rows.filter((r) => r.problem === null).length,
      unmatchedCount: rows.filter((r) => r.problem !== null && !r.alreadySettled).length,
      alreadySettledCount: rows.filter((r) => r.alreadySettled).length,
      allocatableInr: allocatable.toFixed(2),
      fileTotalInr: fileTotal.toFixed(2),
    };
  }

  /** Decimal or null — never NaN, and never a silent zero. */
  private money(raw: string): Prisma.Decimal | null {
    const t = raw.trim();
    if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    try {
      return new Prisma.Decimal(t);
    } catch {
      return null;
    }
  }
}
