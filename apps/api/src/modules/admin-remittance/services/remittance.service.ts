import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { WithdrawalRequestService } from '../../seller-wallet-withdrawal/services/withdrawal-request.service';
import type { CreateRemittanceDto } from '../dto/create-remittance.dto';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { BankLedgerService } from '../../treasury/services/bank-ledger.service';

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
  private readonly logger = new Logger(RemittanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
    private readonly bank: BankLedgerService,
    private readonly withdrawals: WithdrawalRequestService,
  ) {}

  /**
   * Close the withdrawal this remittance just paid.
   *
   * The link used to be a separate step: record the payment here, then
   * go to Withdrawals and paste the remittance id. That step is how a
   * seller who HAS been paid stays "awaiting review" for a week —
   * nothing reminds anybody, and the queue looks like work that has not
   * happened.
   *
   * Done on the SERVER rather than in the button that happened to open
   * the form, so it holds however the remittance was created — the
   * general Record button, the Pay button on the approved list, or a
   * direct API call.
   *
   * ONLY when it is unambiguous: exactly one approved request for that
   * seller, and its amount equals what was sent. Two open requests, or
   * an amount that does not match, is a judgement about which debt was
   * settled and by how much — that belongs to a person. Guessing would
   * mark a request paid against money that did not pay it, and the
   * seller would be told so.
   *
   * BEST-EFFORT by construction: the remittance is the money and it has
   * already committed. A failure here leaves the request open, which is
   * the state it was in a moment ago and which a human can still close.
   */
  private async closeMatchingWithdrawal(
    sellerId: string,
    remittanceId: string,
    amountSent: Prisma.Decimal,
    staffId: string,
  ): Promise<void> {
    try {
      const approved = await this.prisma.client.withdrawalRequest.findMany({
        where: { sellerId, status: WithdrawalRequestStatus.APPROVED },
        select: { id: true, amountRequested: true },
        take: 2,
      });
      if (approved.length !== 1) return;
      const only = approved[0];
      if (only === undefined || !only.amountRequested.equals(amountSent)) return;

      await this.withdrawals.markPaid(only.id, staffId, remittanceId);
      this.logger.log(
        `remittance ${remittanceId} closed withdrawal request ${only.id} for seller ${sellerId}`,
      );
    } catch (err) {
      this.logger.warn(
        `remittance ${remittanceId} recorded, but its withdrawal request was not closed: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

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
            // The branch is part of the withdrawal instruction, not decoration.
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
          paidFromAccountId: input.paidFromAccountId,
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

      // The cash side. The wallet debit says the seller is no longer
      // owed it; this says which of our accounts it physically left, in
      // what actually left — `amount` in `currency` is what hit their
      // bank, and that is what our account was debited. `sourceAmount`
      // is the wallet's INR view of the same payment and would be the
      // wrong number to take out of a BDT account.
      await this.bank.post(
        {
          accountId: input.paidFromAccountId,
          type: BankEntryType.SELLER_WITHDRAWAL,
          signedAmount: amount.neg(),
          amountCurrency: input.currency,
          owner: { kind: BankOwnerKind.SELLER, sellerId: input.sellerId },
          occurredAt: new Date(input.paidAt),
          reference: input.bankReference.trim(),
          staffId: actor.staffId,
          note: 'Paid out to the seller',
        },
        tx,
      );

      // NO paired credit on the destination currency.
      //
      // This used to write a REMITTANCE_FX credit for the converted
      // amount, described as conserving the ledger. That is a
      // double-entry instinct applied where it does not hold: the money
      // did not move between two pots we keep, it LEFT the business into
      // the seller's bank. Crediting the destination wallet left every
      // seller reading "you are owed ৳12,300" immediately after being
      // paid ৳12,300, and nothing ever debited it back — so the phantom
      // balance grew by the size of every withdrawal, forever.
      //
      // What was actually wired is not lost: `remittances` records the
      // destination currency, the amount and the FX rate snapshot. That
      // is the record of the payment. The wallet's job is what is still
      // OWED, and after a remittance that is the source debit alone.
      //
      // Safe to change: production carries zero remittances, so there is
      // no phantom balance to unwind. If one ever appears in a restored
      // environment, it is an ADJUSTMENT_DEBIT with a reason, never a
      // deletion — the ledger is append-only.

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
    // No destination-currency recompute: nothing was written there.

    await this.closeMatchingWithdrawal(input.sellerId, result.id, sourceAmount, actor.staffId);

    return { id: result.id };
  }

  async list(query: { sellerId?: string; page?: number; pageSize?: number }): Promise<{
    items: Array<{
      id: string;
      sellerId: string;
      /** Who was paid. A payout history that identifies people by uuid
       *  prefix is not a history anybody can read. */
      sellerName: string | null;
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
          seller: { select: { companyName: true } },
        },
      }),
      this.prisma.client.remittance.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        sellerId: r.sellerId,
        sellerName: r.seller?.companyName ?? null,
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
