import { Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Currency, FxRateSource, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/**
 * Module 16 — Multi-Currency & FX. INR is canonical; BDT is display
 * only via FX conversion (per CLAUDE.md general rules). The FxRate
 * table stores ONE current rate per `(from, to)` pair (the unique
 * constraint); historical timeseries is a Phase-1B deferral (the
 * order persists the as-of-then rate in its own metadata when needed).
 *
 * Admin override flow: `setManualRate` creates an UPDATE on the
 * existing row (or upserts if missing), setting source=MANUAL +
 * isManualOverride=true + overrideByStaffId + overrideReason. The
 * previous rate is preserved in the audit log's `changes` JSON.
 *
 * External fetch (exchangerate.host / open-exchange-rates) is OUT
 * of Phase-1A scope — the rate fetcher is a Phase-1B deliverable
 * tracked under phase-1a-debt's "Historical FX rate tracking" entry.
 */

export interface FxRateView {
  readonly fromCurrency: Currency;
  readonly toCurrency: Currency;
  readonly rate: string;
  readonly source: FxRateSource;
  readonly fetchedAt: string;
  readonly isManualOverride: boolean;
  readonly overrideReason: string | null;
  readonly overrideByStaffId: string | null;
}

export interface ConvertInput {
  readonly amount: number | string | Prisma.Decimal;
  readonly from: Currency;
  readonly to: Currency;
}

export interface ConvertOutput {
  readonly amount: string;
  readonly rate: string;
}

@Injectable()
export class FxRateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(): Promise<readonly FxRateView[]> {
    const rows = await this.prisma.client.fxRate.findMany({
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  async getRate(from: Currency, to: Currency): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);
    const row = await this.prisma.client.fxRate.findUnique({
      where: { fromCurrency_toCurrency: { fromCurrency: from, toCurrency: to } },
    });
    if (!row) {
      // Try the inverse and reciprocate.
      const inverse = await this.prisma.client.fxRate.findUnique({
        where: { fromCurrency_toCurrency: { fromCurrency: to, toCurrency: from } },
      });
      if (inverse) {
        return new Prisma.Decimal(1).dividedBy(inverse.rate);
      }
      throw new NotFoundException({
        code: 'FX_RATE_NOT_FOUND',
        message: `No FX rate configured for ${from} → ${to}`,
      });
    }
    return new Prisma.Decimal(row.rate);
  }

  async convert(input: ConvertInput): Promise<ConvertOutput> {
    const rate = await this.getRate(input.from, input.to);
    const amount = new Prisma.Decimal(input.amount).times(rate);
    return { amount: amount.toFixed(2), rate: rate.toFixed(6) };
  }

  /**
   * Admin manual override. Upserts the rate with source=MANUAL +
   * isManualOverride=true; audits MEDIUM with the previous value.
   */
  async setManualRate(input: {
    from: Currency;
    to: Currency;
    rate: number | string;
    staffId: string;
    reason: string;
  }): Promise<FxRateView> {
    if (input.from === input.to) {
      throw new NotFoundException({
        code: 'SAME_CURRENCY',
        message: 'Cannot set a rate for same-currency conversion',
      });
    }
    const parsed = new Prisma.Decimal(input.rate);
    if (parsed.lessThanOrEqualTo(0)) {
      throw new NotFoundException({
        code: 'INVALID_RATE',
        message: 'Rate must be > 0',
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.fxRate.findUnique({
        where: {
          fromCurrency_toCurrency: { fromCurrency: input.from, toCurrency: input.to },
        },
      });
      const previousRate = existing?.rate.toString() ?? null;

      const upserted = await tx.fxRate.upsert({
        where: {
          fromCurrency_toCurrency: { fromCurrency: input.from, toCurrency: input.to },
        },
        create: {
          fromCurrency: input.from,
          toCurrency: input.to,
          rate: parsed,
          source: FxRateSource.MANUAL,
          isManualOverride: true,
          overrideByStaffId: input.staffId,
          overrideReason: input.reason,
          fetchedAt: new Date(),
        },
        update: {
          rate: parsed,
          source: FxRateSource.MANUAL,
          isManualOverride: true,
          overrideByStaffId: input.staffId,
          overrideReason: input.reason,
          fetchedAt: new Date(),
        },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: input.staffId,
          action: 'staff.fx_rate.manual_override',
          entityType: 'fx_rate',
          entityId: upserted.id,
          changes: {
            from: input.from,
            to: input.to,
            before: previousRate,
            after: parsed.toString(),
            reason: input.reason,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      return this.toView(upserted);
    });
  }

  private toView(row: Prisma.FxRateGetPayload<object>): FxRateView {
    return {
      fromCurrency: row.fromCurrency,
      toCurrency: row.toCurrency,
      rate: row.rate.toString(),
      source: row.source,
      fetchedAt: row.fetchedAt.toISOString(),
      isManualOverride: row.isManualOverride,
      overrideReason: row.overrideReason,
      overrideByStaffId: row.overrideByStaffId,
    };
  }
}
