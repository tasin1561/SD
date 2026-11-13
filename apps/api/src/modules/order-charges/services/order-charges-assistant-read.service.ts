import { Injectable } from '@nestjs/common';
import { Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * What the assistant may read about an order's PERSISTED charges — a
 * deliberately NARROW projection of `order_charges`, read-only.
 *
 * ── NOTHING IS RECOMPUTED ────────────────────────────────────────────
 * Every figure here is a stored column (`amountInr`, `taxAmountInr`,
 * `totalAmountInr`) or a field the pricing engine STAMPED into
 * `computationContext.flatFee` when the charge was taken (PRC-8: the
 * agreed amount and currency, and the rate it was converted at). The
 * pricing engine is not injected and cannot be called from here, so
 * "why was I charged ₹162.60?" is answered from what happened then, never
 * from today's fee settings or today's rate.
 *
 * ── WHAT IS NEVER COPIED ─────────────────────────────────────────────
 * `computationContext` also carries `margin` (OUR margin on the parcel),
 * the rate-card and rule ids, and the seller id. Only the six `flatFee`
 * fields below are read out of it, one by one, after a type check — the
 * blob itself never reaches the model. `isVisibleToSeller = false` rows
 * are excluded in the query, the same filter the seller route applies.
 *
 * ── THE SCOPE IS A WHERE CLAUSE ──────────────────────────────────────
 * The order is looked up with the caller's `sellerId` in the `where`; an
 * order that is somebody else's is the same `null` as one that does not
 * exist.
 */
export interface AssistantChargeLine {
  /** What the line is called: its stored description, else the type in words. */
  readonly label: string;
  readonly type: string;
  /** The line's state in a word — "Estimated", "Final" … — as the console shows it. */
  readonly state: string;
  readonly amountInr: string;
  readonly taxRate: string | null;
  readonly taxAmountInr: string | null;
  readonly totalInr: string;
  /** PRC-8: how the fee was AGREED and converted. Present on the delivery-fee line only. */
  readonly agreed: {
    readonly amount: string;
    readonly currency: string | null;
    /** `SELLER_OVERRIDE` = the client's own negotiated fee; `SYSTEM_DEFAULT` = the standard one. */
    readonly feeSource: string | null;
    /** Null when the fee was already in rupees. */
    readonly fxRate: string | null;
    readonly fxRatePair: string | null;
    readonly fxRateRecordedAt: string | null;
  } | null;
}

export interface AssistantOrderCharges {
  readonly orderNumber: string;
  readonly orderStatus: string;
  readonly paymentMode: string;
  readonly lines: readonly AssistantChargeLine[];
  /** The sum of the stored line totals (what the console's Total row shows). */
  readonly totalInr: string;
}

const STATE_WORD: Readonly<Record<string, string>> = {
  ESTIMATED: 'Estimated',
  CONFIRMED: 'Confirmed',
  FINAL: 'Final',
  DISPUTED: 'Disputed',
  ADJUSTED: 'Adjusted',
};

function humanize(type: string): string {
  return type
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** The stamped PRC-8 fields, read one at a time from an untyped JSON blob. */
function agreedFrom(context: unknown): AssistantChargeLine['agreed'] {
  if (typeof context !== 'object' || context === null) return null;
  const flat = (context as { flatFee?: unknown }).flatFee;
  if (typeof flat !== 'object' || flat === null) return null;
  const f = flat as Record<string, unknown>;
  const amount = str(f.agreedAmount);
  if (amount === null) return null;
  return {
    amount,
    currency: str(f.agreedCurrency),
    feeSource: str(f.source),
    fxRate: str(f.fxRate),
    fxRatePair: str(f.fxRatePair),
    fxRateRecordedAt: str(f.fxRateRecordedAt),
  };
}

@Injectable()
export class OrderChargesAssistantReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** The client's own order's charges, or null when no such order is theirs. */
  async forSeller(sellerId: string, orderId: string): Promise<AssistantOrderCharges | null> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, sellerId, deletedAt: null },
      select: { id: true, orderNumber: true, status: true, paymentMode: true },
    });
    if (order === null) return null;
    const rows = await this.prisma.client.orderCharge.findMany({
      where: { orderId: order.id, isVisibleToSeller: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        type: true,
        description: true,
        status: true,
        amountInr: true,
        taxRate: true,
        taxAmountInr: true,
        totalAmountInr: true,
        computationContext: true,
      },
    });
    const total = rows.reduce((sum, r) => sum.add(r.totalAmountInr), new Prisma.Decimal(0));
    return {
      orderNumber: order.orderNumber,
      orderStatus: String(order.status),
      paymentMode: String(order.paymentMode),
      lines: rows.map((r) => ({
        label: r.description ?? humanize(String(r.type)),
        type: String(r.type),
        state: STATE_WORD[String(r.status)] ?? String(r.status).toLowerCase(),
        amountInr: r.amountInr.toFixed(2),
        taxRate: r.taxRate?.toFixed(2) ?? null,
        taxAmountInr: r.taxAmountInr?.toFixed(2) ?? null,
        totalInr: r.totalAmountInr.toFixed(2),
        agreed: agreedFrom(r.computationContext),
      })),
      totalInr: total.toFixed(2),
    };
  }
}
