import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  InboundFreightMode,
  InboundFreightStatus,
  Prisma,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

export interface FreightChargeView {
  readonly id: string;
  readonly goodsReceiptId: string;
  readonly receiptNumber: string | null;
  readonly amountInr: string;
  readonly mode: InboundFreightMode;
  readonly serviceChargePercent: string | null;
  readonly serviceChargeInr: string | null;
  readonly totalInr: string;
  readonly status: InboundFreightStatus;
  readonly settledAt: Date | null;
  readonly walletEntryId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

export interface RecordFreightInput {
  readonly goodsReceiptId: string;
  readonly amountInr: string;
  /** Overrides the seller's resolved mode for this one consignment. */
  readonly mode?: InboundFreightMode;
  readonly note?: string | null;
}

const SETTING_MODE = 'wallet.inbound_freight_mode';
const SETTING_SERVICE_CHARGE = 'wallet.inbound_freight_service_charge_percent';

/**
 * R3 — the BD→India inbound freight bill.
 *
 * This is a SEPARATE money flow from the outbound courier fee: that one
 * is per-order, India-domestic, and lands as `ORDER_CHARGES`. This one is
 * per-consignment, cross-border, and lands as `INBOUND_FREIGHT`. Keeping
 * them apart is what makes "what did it cost to get this stock into
 * India" answerable at all.
 *
 * ── SAGA / ORDERING ───────────────────────────────────────────────────
 * `record` and `settle` each open ONE transaction that writes the charge
 * row AND (when settling) the wallet debit through
 * `WalletService.applyEntry` — the wallet writer takes a tx, so unlike
 * the M5 stock services this genuinely composes, and no saga is needed.
 * The stamped `walletEntryId` is both the FK and the idempotency
 * evidence: a bill can be settled exactly once.
 *
 * Idempotency:
 *  - `record` is gated by the UNIQUE `goods_receipt_id` — a re-submit
 *    returns the existing bill rather than double-billing the seller.
 *  - `settle` is gated on `status === PENDING`; an already-settled or
 *    waived bill is a 409, never a second debit.
 *
 * PAY_LATER deliberately does NOT auto-pay-down from future delivery
 * credits. Doing so needs answers the founder has not given: which debt
 * settles first when several are outstanding, whether partial settlement
 * is allowed, and whether a credit may be consumed before the seller has
 * seen it. Until then the receivable is VISIBLE (a PENDING row on both
 * the admin and seller side) and settled by a deliberate action —
 * tracked as R3b.
 */
@Injectable()
export class InboundFreightService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Ops records the freight invoice for a consignment. PAY_NOW settles in
   * the same transaction; PAY_LATER leaves a visible receivable.
   */
  async record(
    staffId: string,
    input: RecordFreightInput,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const amount = this.parseAmount(input.amountInr);

    const receipt = await this.prisma.client.goodsReceipt.findFirst({
      where: { id: input.goodsReceiptId, deletedAt: null },
      select: { id: true, sellerId: true, receiptNumber: true },
    });
    if (!receipt) {
      throw new NotFoundException({
        code: 'GOODS_RECEIPT_NOT_FOUND',
        message: `Goods receipt ${input.goodsReceiptId} not found`,
      });
    }

    // Idempotency: one bill per consignment. A re-submit returns what is
    // already there instead of billing the seller twice.
    const existing = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { goodsReceiptId: receipt.id },
      include: { goodsReceipt: { select: { receiptNumber: true } } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'FREIGHT_ALREADY_RECORDED',
        message: `Goods receipt ${receipt.receiptNumber} already carries a freight bill (${existing.status})`,
        cause: { freightChargeId: existing.id, status: existing.status },
      });
    }

    const mode = input.mode ?? (await this.resolveMode(receipt.sellerId));
    // The service charge is snapshotted at record time and never
    // re-resolved at settlement: the seller owes the rate that applied
    // when their consignment landed, not whatever the setting says weeks
    // later.
    const percent =
      mode === InboundFreightMode.PAY_LATER
        ? await this.resolveServiceChargePercent(receipt.sellerId)
        : null;
    const serviceCharge =
      percent === null || percent.isZero()
        ? null
        : amount.mul(percent).div(100).toDecimalPlaces(2);
    const total = serviceCharge === null ? amount : amount.add(serviceCharge);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const settleNow = mode === InboundFreightMode.PAY_NOW;
      let walletEntryId: string | null = null;
      if (settleNow) {
        const entry = await this.wallet.applyEntry(tx, {
          sellerId: receipt.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.INBOUND_FREIGHT,
          amount: total,
          actorType: ActorType.STAFF,
          actorId: staffId,
          note: `Inbound freight for ${receipt.receiptNumber}`,
        });
        walletEntryId = entry.id;
      }

      const row = await tx.inboundFreightCharge.create({
        data: {
          sellerId: receipt.sellerId,
          goodsReceiptId: receipt.id,
          amountInr: amount,
          mode,
          serviceChargePercent: percent,
          serviceChargeInr: serviceCharge,
          totalInr: total,
          status: settleNow
            ? InboundFreightStatus.SETTLED
            : InboundFreightStatus.PENDING,
          ...(settleNow
            ? { settledAt: new Date(), settledByStaffId: staffId, walletEntryId }
            : {}),
          note: input.note ?? null,
        },
        include: { goodsReceipt: { select: { receiptNumber: true } } },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: receipt.sellerId,
          action: 'wallet.inbound_freight.recorded',
          entityType: 'inbound_freight_charge',
          entityId: row.id,
          severity: 'MEDIUM',
          metadata: {
            goodsReceiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
            amountInr: amount.toString(),
            mode,
            serviceChargeInr: serviceCharge?.toString() ?? null,
            totalInr: total.toString(),
            settledImmediately: settleNow,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });

    return this.toView(created);
  }

  /** Settle a PENDING (PAY_LATER) bill against the seller's wallet. */
  async settle(
    staffId: string,
    freightChargeId: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    const charge = await this.load(freightChargeId);
    if (charge.status !== InboundFreightStatus.PENDING) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_PENDING',
        message: `Freight bill is ${charge.status}; only a PENDING bill can be settled`,
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      // Re-guard INSIDE the tx: two operators clicking "settle" must not
      // produce two debits.
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: { id: freightChargeId, status: InboundFreightStatus.PENDING },
        data: { status: InboundFreightStatus.SETTLED, settledAt: new Date(), settledByStaffId: staffId },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was settled by another operator',
        });
      }

      const entry = await this.wallet.applyEntry(tx, {
        sellerId: charge.sellerId,
        currency: Currency.INR,
        direction: WalletEntryDirection.INBOUND_FREIGHT,
        amount: charge.totalInr,
        actorType: ActorType.STAFF,
        actorId: staffId,
        note: `Inbound freight for ${charge.goodsReceipt.receiptNumber}`,
      });

      const row = await tx.inboundFreightCharge.update({
        where: { id: freightChargeId },
        data: { walletEntryId: entry.id },
        include: { goodsReceipt: { select: { receiptNumber: true } } },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: charge.sellerId,
          action: 'wallet.inbound_freight.settled',
          entityType: 'inbound_freight_charge',
          entityId: freightChargeId,
          severity: 'MEDIUM',
          metadata: {
            totalInr: charge.totalInr.toString(),
            walletEntryId: entry.id,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return row;
    });

    return this.toView(updated);
  }

  /**
   * Ops forgives a PENDING bill (our own mishandling, goodwill). No
   * wallet movement — WAIVED is deliberately distinct from SETTLED so
   * write-offs stay countable rather than hiding inside collections.
   */
  async waive(
    staffId: string,
    freightChargeId: string,
    reason: string,
    ctx?: ClientContext,
  ): Promise<FreightChargeView> {
    if (reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'FREIGHT_WAIVE_REASON_TOO_SHORT',
        message: 'A waiver reason of at least 10 characters is required',
      });
    }
    const charge = await this.load(freightChargeId);
    if (charge.status !== InboundFreightStatus.PENDING) {
      throw new ConflictException({
        code: 'FREIGHT_NOT_PENDING',
        message: `Freight bill is ${charge.status}; only a PENDING bill can be waived`,
      });
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.inboundFreightCharge.updateMany({
        where: { id: freightChargeId, status: InboundFreightStatus.PENDING },
        data: {
          status: InboundFreightStatus.WAIVED,
          settledAt: new Date(),
          settledByStaffId: staffId,
          note: charge.note === null ? reason : `${charge.note}\n${reason}`,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: 'FREIGHT_NOT_PENDING',
          message: 'Freight bill was resolved by another operator',
        });
      }
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffId,
          sellerId: charge.sellerId,
          action: 'wallet.inbound_freight.waived',
          entityType: 'inbound_freight_charge',
          entityId: freightChargeId,
          severity: 'HIGH',
          metadata: {
            totalInr: charge.totalInr.toString(),
            reason,
            ...this.ctxMeta(ctx),
          },
        },
        tx,
      );
      return tx.inboundFreightCharge.findUniqueOrThrow({
        where: { id: freightChargeId },
        include: { goodsReceipt: { select: { receiptNumber: true } } },
      });
    });

    return this.toView(updated);
  }

  async listForSeller(
    sellerId: string,
    status?: InboundFreightStatus,
  ): Promise<readonly FreightChargeView[]> {
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      where: { sellerId, ...(status === undefined ? {} : { status }) },
      include: { goodsReceipt: { select: { receiptNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  async listForAdmin(query: {
    sellerId?: string;
    status?: InboundFreightStatus;
  }): Promise<readonly FreightChargeView[]> {
    const rows = await this.prisma.client.inboundFreightCharge.findMany({
      where: {
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
        ...(query.status === undefined ? {} : { status: query.status }),
      },
      include: { goodsReceipt: { select: { receiptNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toView(r));
  }

  /** Total INR a seller still owes for inbound freight. */
  async outstandingForSeller(sellerId: string): Promise<string> {
    const agg = await this.prisma.client.inboundFreightCharge.aggregate({
      where: { sellerId, status: InboundFreightStatus.PENDING },
      _sum: { totalInr: true },
    });
    return (agg._sum.totalInr ?? new Prisma.Decimal(0)).toString();
  }

  // ── internal ──────────────────────────────────────────────────────

  private async load(id: string): Promise<
    Prisma.InboundFreightChargeGetPayload<{
      include: { goodsReceipt: { select: { receiptNumber: true } } };
    }>
  > {
    const row = await this.prisma.client.inboundFreightCharge.findUnique({
      where: { id },
      include: { goodsReceipt: { select: { receiptNumber: true } } },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'FREIGHT_CHARGE_NOT_FOUND',
        message: `Freight charge ${id} not found`,
      });
    }
    return row;
  }

  private parseAmount(raw: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(raw);
    } catch {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message: `'${raw}' is not a valid amount`,
      });
    }
    if (!amount.isFinite() || amount.lte(0)) {
      throw new BadRequestException({
        code: 'FREIGHT_AMOUNT_INVALID',
        message: 'Freight amount must be greater than zero',
      });
    }
    return amount.toDecimalPlaces(2);
  }

  /** Defaults to PAY_NOW — the simpler money flow — on any doubt. */
  private async resolveMode(sellerId: string): Promise<InboundFreightMode> {
    try {
      const resolved = await this.settings.resolve(sellerId, SETTING_MODE);
      return String(resolved.value).toUpperCase() === 'PAY_LATER'
        ? InboundFreightMode.PAY_LATER
        : InboundFreightMode.PAY_NOW;
    } catch {
      return InboundFreightMode.PAY_NOW;
    }
  }

  /**
   * Defaults to ZERO on any doubt: a seller must never be charged for
   * credit terms that were not explicitly quoted to them.
   */
  private async resolveServiceChargePercent(
    sellerId: string,
  ): Promise<Prisma.Decimal> {
    try {
      const resolved = await this.settings.resolve(
        sellerId,
        SETTING_SERVICE_CHARGE,
      );
      const pct = new Prisma.Decimal(String(resolved.value ?? '0'));
      return pct.isFinite() && pct.gt(0) ? pct : new Prisma.Decimal(0);
    } catch {
      return new Prisma.Decimal(0);
    }
  }

  private toView(
    row: Prisma.InboundFreightChargeGetPayload<{
      include: { goodsReceipt: { select: { receiptNumber: true } } };
    }>,
  ): FreightChargeView {
    return {
      id: row.id,
      goodsReceiptId: row.goodsReceiptId,
      receiptNumber: row.goodsReceipt?.receiptNumber ?? null,
      amountInr: row.amountInr.toString(),
      mode: row.mode,
      serviceChargePercent: row.serviceChargePercent?.toString() ?? null,
      serviceChargeInr: row.serviceChargeInr?.toString() ?? null,
      totalInr: row.totalInr.toString(),
      status: row.status,
      settledAt: row.settledAt,
      walletEntryId: row.walletEntryId,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  private ctxMeta(ctx?: ClientContext): Record<string, string | null> {
    return {
      ipAddress: ctx?.ipAddress ?? null,
      userAgent: ctx?.userAgent ?? null,
      requestId: ctx?.requestId ?? null,
    };
  }
}
