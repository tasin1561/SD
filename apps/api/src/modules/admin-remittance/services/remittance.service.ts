import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, Currency, Prisma, WalletEntryDirection } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import type { CreateRemittanceDto } from '../dto/create-remittance.dto';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * Phase 1B M23 — Admin records a manual bank transfer to a seller.
 *
 * Discipline (per W-6 / W-7 in the plan):
 *  - Snapshot the seller's bank fields onto the Remittance row so a
 *    future bank-fields edit doesn't rewrite history.
 *  - Negative-balance guard: the wallet must hold ≥ sourceAmount on
 *    sourceCurrency BEFORE we write the REMITTANCE_OUT debit; the
 *    check happens INSIDE the same tx (so a concurrent write can't
 *    sneak between check and debit).
 *  - For cross-currency, write a paired REMITTANCE_FX CREDIT on the
 *    destination currency wallet so BOTH ledgers conserve. Same tx.
 *  - Audit row MEDIUM with the before/after balance snapshots.
 */
@Injectable()
export class RemittanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
  ) {}

  async create(
    input: CreateRemittanceDto,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<{ id: string }> {
    const seller = await this.prisma.client.seller.findUnique({
      where: { id: input.sellerId },
      select: {
        id: true,
        bankName: true,
        bankBranchName: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankRoutingNumber: true,
        bankSwiftCode: true,
      },
    });
    if (!seller) {
      throw new NotFoundException({
        code: 'SELLER_NOT_FOUND',
        message: 'Seller not found',
      });
    }
    if (!seller.bankAccountNumber || !seller.bankName || !seller.bankAccountName) {
      throw new BadRequestException({
        code: 'BANK_DETAILS_MISSING',
        message:
          'Seller has incomplete bank details; cannot record a remittance until they fill in bank name, account name, and account number',
      });
    }

    const sourceAmount = new Prisma.Decimal(input.sourceAmount);
    const amount = new Prisma.Decimal(input.amount);
    const fxRate = new Prisma.Decimal(input.fxRateSnapshot);

    if (input.sourceCurrency === input.currency && !fxRate.eq(1)) {
      throw new BadRequestException({
        code: 'INVALID_FX_RATE_SAME_CURRENCY',
        message: 'fxRateSnapshot must be 1 when sourceCurrency === currency',
      });
    }
    // sanity: destination amount ≈ source × fx (allow 0.01 rounding)
    const expectedDest = sourceAmount.mul(fxRate);
    if (expectedDest.sub(amount).abs().gt(new Prisma.Decimal('0.01'))) {
      throw new BadRequestException({
        code: 'AMOUNT_FX_MISMATCH',
        message: `amount (${amount}) does not match sourceAmount × fxRateSnapshot (${expectedDest.toFixed(2)}); within 0.01 tolerance`,
      });
    }

    const result = await this.prisma.client.$transaction(async (tx) => {
      const balance = await this.wallet.balanceLive(input.sellerId, input.sourceCurrency, tx);
      if (balance.lt(sourceAmount)) {
        throw new BadRequestException({
          code: 'INSUFFICIENT_WALLET_BALANCE',
          message: `Wallet balance for ${input.sourceCurrency} (${balance}) is less than sourceAmount (${sourceAmount})`,
        });
      }

      const remittance = await tx.remittance.create({
        data: {
          sellerId: input.sellerId,
          currency: input.currency,
          amount,
          sourceCurrency: input.sourceCurrency,
          sourceAmount,
          fxRateSnapshot: fxRate,
          bankAccountSnapshot: {
            bankName: seller.bankName,
            // The branch is part of the payout instruction, not decoration.
            // The seller is now hard-refused on save without it, and that
            // block is only defensible if the value reaches the thing it
            // was demanded for — a snapshot missing it would make the
            // requirement pure ceremony.
            bankBranchName: seller.bankBranchName,
            bankAccountName: seller.bankAccountName,
            bankAccountNumber: seller.bankAccountNumber,
            bankRoutingNumber: seller.bankRoutingNumber,
            bankSwiftCode: seller.bankSwiftCode,
          },
          bankReference: input.bankReference.trim(),
          paidAt: new Date(input.paidAt),
          staffId: actor.staffId,
          note: input.note?.trim() ?? null,
        },
        select: { id: true },
      });

      // W-2 paired entries — both via the sole writer.
      await this.wallet.applyEntry(tx, {
        sellerId: input.sellerId,
        currency: input.sourceCurrency,
        direction: WalletEntryDirection.REMITTANCE_OUT,
        amount: sourceAmount,
        linkedRemittanceId: remittance.id,
        reasonCode: 'REMITTANCE',
        actorType: ActorType.STAFF,
        actorId: actor.staffId,
        fxRateSnapshot: fxRate,
      });

      if (input.sourceCurrency !== input.currency) {
        // Paired credit on the destination wallet — conserves ledger.
        await this.wallet.applyEntry(tx, {
          sellerId: input.sellerId,
          currency: input.currency,
          direction: WalletEntryDirection.REMITTANCE_FX,
          amount,
          linkedRemittanceId: remittance.id,
          reasonCode: 'REMITTANCE_FX_CONVERT',
          actorType: ActorType.STAFF,
          actorId: actor.staffId,
          fxRateSnapshot: fxRate,
        });
      }

      return remittance;
    });

    // Audit + cache recompute (post-commit).
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      sellerId: input.sellerId,
      action: 'staff.remittance.created',
      entityType: 'remittance',
      entityId: result.id,
      severity: 'MEDIUM',
      changes: {
        currency: input.currency,
        amount: amount.toString(),
        sourceCurrency: input.sourceCurrency,
        sourceAmount: sourceAmount.toString(),
        fxRateSnapshot: fxRate.toString(),
        bankReference: input.bankReference,
      },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    await this.wallet.recomputeCacheAfterCommit(
      input.sellerId,
      input.sourceCurrency,
      'post-remittance',
    );
    if (input.sourceCurrency !== input.currency) {
      await this.wallet.recomputeCacheAfterCommit(
        input.sellerId,
        input.currency,
        'post-remittance-fx',
      );
    }

    return { id: result.id };
  }

  async list(query: { sellerId?: string; page?: number; pageSize?: number }): Promise<{
    items: Array<{
      id: string;
      sellerId: string;
      currency: Currency;
      amount: string;
      sourceCurrency: Currency;
      sourceAmount: string;
      fxRateSnapshot: string;
      bankReference: string;
      paidAt: string;
      note: string | null;
      createdAt: string;
    }>;
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
    const where = query.sellerId ? { sellerId: query.sellerId } : {};
    const [rows, total] = await Promise.all([
      this.prisma.client.remittance.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sellerId: true,
          currency: true,
          amount: true,
          sourceCurrency: true,
          sourceAmount: true,
          fxRateSnapshot: true,
          bankReference: true,
          paidAt: true,
          note: true,
          createdAt: true,
        },
      }),
      this.prisma.client.remittance.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        sellerId: r.sellerId,
        currency: r.currency,
        amount: r.amount.toString(),
        sourceCurrency: r.sourceCurrency,
        sourceAmount: r.sourceAmount.toString(),
        fxRateSnapshot: r.fxRateSnapshot.toString(),
        bankReference: r.bankReference,
        paidAt: r.paidAt.toISOString(),
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
