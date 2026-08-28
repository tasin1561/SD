import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankEntryType, BankOwnerKind, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { BankLedgerService } from './bank-ledger.service';

export interface TransferInput {
  readonly fromAccountId: string;
  readonly toAccountId: string;
  readonly amountOut: string;
  readonly amountIn: string;
  /** Whose money is moving. Null for a pure liquidity move of our own. */
  readonly sellerId?: string | null;
  /**
   * The rate the seller was SHOWN. Only meaningful cross-currency, and
   * only when the money is a seller's.
   */
  readonly quotedRate?: string | null;
  readonly movedAt: Date;
  readonly reference?: string | null;
  readonly note?: string | null;
  readonly staffId: string;
}

export interface TransferResult {
  readonly transferId: string;
  readonly achievedRate: string | null;
  /** Positive: we kept it. Negative: we covered it from capital. */
  readonly fxSpread: string | null;
  readonly creditedToSeller: string;
}

/**
 * Moving money between our own accounts, including across a currency.
 *
 * BOTH AMOUNTS ARE GIVEN, never an amount and a rate. The rate moves
 * hour to hour, so a stored rate and a recomputed figure will disagree
 * with the statement; two amounts cannot.
 *
 * ── THE CROSS-CURRENCY RULE ──────────────────────────────────────────
 * A seller is shown a rate when they ask for their money. That quote is
 * a promise, so their sub-balance is credited at the QUOTED rate, not at
 * whatever the bank gave us:
 *
 *   ₹1,000 quoted at 1.30  →  seller is credited ৳1,300
 *   the bank gave 1.35     →  ৳1,350 arrived, ৳50 is ours
 *   the bank gave 1.25     →  ৳1,250 arrived, ৳50 comes out of capital
 *
 * The seller receives what they were promised either way. The difference
 * is the business we are in, and posting it as its own FX_SPREAD entry
 * is what makes it countable rather than lost inside a balance.
 *
 * That quote is also what lets per-seller attribution survive a currency
 * boundary at all: without a promised rate there is no principled figure
 * to credit on the other side, and the two ledgers drift apart.
 */
@Injectable()
export class BankTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BankLedgerService,
    private readonly audit: AuditLogService,
  ) {}

  async transfer(input: TransferInput): Promise<TransferResult> {
    const out = new Prisma.Decimal(input.amountOut);
    const inn = new Prisma.Decimal(input.amountIn);
    if (out.lte(0) || inn.lte(0)) {
      throw new BadRequestException({
        code: 'TRANSFER_INVALID_AMOUNT',
        message: 'Both the sent and the received amount must be positive',
      });
    }
    if (input.fromAccountId === input.toAccountId) {
      throw new BadRequestException({
        code: 'TRANSFER_SAME_ACCOUNT',
        message: 'An account cannot transfer to itself',
      });
    }

    const [from, to] = await Promise.all([
      this.account(input.fromAccountId),
      this.account(input.toAccountId),
    ]);

    const crossCurrency = from.currency !== to.currency;
    if (!crossCurrency && !out.equals(inn)) {
      // Same currency and different amounts means something was lost,
      // and a bank fee is an EXPENSE with a name — not a quiet shortfall
      // inside a transfer.
      throw new BadRequestException({
        code: 'TRANSFER_AMOUNT_MISMATCH',
        message:
          'Same-currency transfers must send and receive the same amount. Record a fee as an expense.',
      });
    }

    const achieved = out.isZero() ? null : inn.div(out).toDecimalPlaces(6);
    const owner = input.sellerId
      ? { kind: BankOwnerKind.SELLER, sellerId: input.sellerId }
      : { kind: BankOwnerKind.CAPITAL };

    // What the seller is owed on the far side. At the quoted rate when
    // there is one; otherwise everything that arrived.
    const quoted = input.quotedRate ? new Prisma.Decimal(input.quotedRate) : null;
    const creditedToSeller =
      input.sellerId && crossCurrency && quoted ? out.mul(quoted).toDecimalPlaces(2) : inn;
    const spread = input.sellerId && crossCurrency ? inn.sub(creditedToSeller) : null;

    return this.prisma.client.$transaction(async (tx) => {
      const transfer = await tx.bankTransfer.create({
        data: {
          fromAccountId: from.id,
          toAccountId: to.id,
          amountOut: out,
          currencyOut: from.currency,
          amountIn: inn,
          currencyIn: to.currency,
          quotedRate: quoted,
          achievedRate: achieved,
          sellerId: input.sellerId ?? null,
          reference: input.reference ?? null,
          note: input.note ?? null,
          movedAt: input.movedAt,
          createdByStaffId: input.staffId,
        },
        select: { id: true },
      });

      await this.ledger.post(
        {
          accountId: from.id,
          type: BankEntryType.TRANSFER_OUT,
          signedAmount: out.neg(),
          owner,
          occurredAt: input.movedAt,
          transferId: transfer.id,
          reference: input.reference ?? null,
          note: input.note ?? null,
          staffId: input.staffId,
        },
        tx,
      );

      await this.ledger.post(
        {
          accountId: to.id,
          type: BankEntryType.TRANSFER_IN,
          signedAmount: creditedToSeller,
          owner,
          occurredAt: input.movedAt,
          transferId: transfer.id,
          reference: input.reference ?? null,
          note: input.note ?? null,
          staffId: input.staffId,
        },
        tx,
      );

      // The spread is CAPITAL's, in the receiving account, and it is
      // posted separately so "what did FX earn this month" is a query
      // rather than an archaeology exercise. Negative when the rate went
      // against us — we honour the quote and carry the difference.
      if (spread !== null && !spread.isZero()) {
        await this.ledger.post(
          {
            accountId: to.id,
            type: BankEntryType.FX_SPREAD,
            signedAmount: spread,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: input.movedAt,
            transferId: transfer.id,
            note:
              `Quoted ${quoted?.toString() ?? '-'}, achieved ${achieved?.toString() ?? '-'}` +
              (spread.isNegative() ? ' — covered from capital' : ''),
            staffId: input.staffId,
          },
          tx,
        );
      }

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: input.staffId,
          action: 'staff.bank_transfer.recorded',
          entityType: 'bank_transfer',
          entityId: transfer.id,
          severity: spread !== null && spread.isNegative() ? 'MEDIUM' : 'LOW',
          metadata: {
            from: from.label,
            to: to.label,
            amountOut: out.toFixed(2),
            amountIn: inn.toFixed(2),
            quotedRate: quoted?.toString() ?? null,
            achievedRate: achieved?.toString() ?? null,
            fxSpread: spread?.toFixed(2) ?? null,
            sellerId: input.sellerId ?? null,
          },
        },
        tx,
      );

      return {
        transferId: transfer.id,
        achievedRate: achieved?.toString() ?? null,
        fxSpread: spread?.toFixed(2) ?? null,
        creditedToSeller: creditedToSeller.toFixed(2),
      };
    });
  }

  private async account(id: string) {
    const a = await this.prisma.client.platformBankAccount.findUnique({
      where: { id },
      select: { id: true, label: true, currency: true, deletedAt: true },
    });
    if (!a || a.deletedAt !== null) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }
    return a;
  }
}
