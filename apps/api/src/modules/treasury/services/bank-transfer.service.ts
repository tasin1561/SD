import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankEntryType, BankOwnerKind, Prisma } from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { BankLedgerService } from './bank-ledger.service';

/** The expense category a same-currency transfer's bank charge is filed under. */
export const BANK_CHARGES_CATEGORY = 'bank_charges';

const ZERO = new Prisma.Decimal(0);

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
  /** What the bank kept on a same-currency move, booked as our expense. */
  readonly bankCharge: string | null;
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
    // Same currency: more arriving than left is not a fee, it is a mistake
    // on the form, and is refused.
    if (!crossCurrency && inn.gt(out)) {
      throw new BadRequestException({
        code: 'TRANSFER_AMOUNT_MISMATCH',
        message:
          'More arrived than was sent in the same currency. Check both statements — a bank ' +
          'charge makes the received amount SMALLER, never larger.',
      });
    }
    // Same currency, less arriving: the difference is what the bank charged
    // to move it. It used to be refused ("record the fee as an expense"),
    // which left the fee to be remembered by hand — and forgotten, it is on
    // no line at all while the account total quietly drops. It is booked
    // here instead, as an EXPENSE in `bank_charges`, OURS.
    //
    // The owner is credited everything that LEFT, not what arrived. That is
    // TRE-5's rule in its same-currency form: a seller's money moved in
    // full, and what the bank took for moving it is our cost of doing so —
    // shrinking their holding by a fee they never agreed to would make the
    // bank book disagree with their wallet. Across a currency the fee is
    // inside the achieved rate: for a seller the quote settles it (the
    // FX_SPREAD below), and for our own money it is part of the exchange,
    // not a separate cost we can see.
    const bankCharge = crossCurrency ? ZERO : out.sub(inn);

    const achieved = out.isZero() ? null : inn.div(out).toDecimalPlaces(6);
    const owner = input.sellerId
      ? { kind: BankOwnerKind.SELLER, sellerId: input.sellerId }
      : { kind: BankOwnerKind.CAPITAL };

    // What the owner is credited on the far side: at the quoted rate when a
    // seller was quoted one; across a currency otherwise, everything that
    // arrived; in the same currency, everything that left.
    const quoted = input.quotedRate ? new Prisma.Decimal(input.quotedRate) : null;
    const creditedToSeller = !crossCurrency
      ? out
      : input.sellerId && quoted
        ? out.mul(quoted).toDecimalPlaces(2)
        : inn;
    const spread = input.sellerId && crossCurrency ? inn.sub(creditedToSeller) : null;

    return this.prisma.client.$transaction(async (tx) => {
      /*
        YOU CANNOT MOVE MORE OF SOMEBODY'S MONEY THAN THEY HAVE HERE.

        "Whose money" is a CHOICE the operator makes on the form, not a
        fact read off a statement, and it was previously unchecked: a
        transfer marked as a seller's could take ₹5,000 out of an account
        holding ₹1,200 of theirs. Nothing failed. The ledger is
        append-only, so the account simply began reporting a NEGATIVE
        held-for-that-seller figure — which is not a real thing, and
        which quietly corrupts the two numbers this whole page exists to
        state: what is ours and what we are holding. TRE-8's clamp says
        the same in the other direction (a seller with no cash here
        produces no entry at all), and this is that invariant enforced at
        the only other place that attributes cash to a person.

        The read is INSIDE the write's transaction and under the same
        per-(account, owner) lock `reconcile` takes (TRE-1), because a
        balance read outside the write it guards is not a guard at all:
        two operators both read ₹1,200 and both move ₹1,000.

        CAPITAL is deliberately NOT checked. Our own account genuinely can
        go overdrawn, and refusing to RECORD money that really left the
        bank would make the book disagree with the statement — which is
        the one thing a bank book must never do. A seller's holding is
        different: it is our arithmetic, not the bank's.
      */
      if (input.sellerId) {
        const ownerKey = `${from.id}|${BankOwnerKind.SELLER}|${input.sellerId}`;
        await takeAdvisoryLock(tx, AdvisoryLock.BANK_RECONCILE, ownerKey);
        const held = await this.ledger.ownerBalance(
          from.id,
          { kind: BankOwnerKind.SELLER, sellerId: input.sellerId },
          tx,
        );
        if (out.gt(held)) {
          throw new BadRequestException({
            code: 'TRANSFER_EXCEEDS_SELLER_HOLDING',
            message:
              `This account holds ${held.toFixed(2)} ${from.currency} for that seller, and the ` +
              `transfer moves ${out.toFixed(2)}. Move at most what they hold here, or record the ` +
              `rest as ours — the difference is not theirs to send.`,
          });
        }
      }

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
          amountCurrency: from.currency,
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
          amountCurrency: to.currency,
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
            amountCurrency: to.currency,
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

      if (bankCharge.gt(0)) {
        const category = await tx.expenseCategory.upsert({
          where: { code: BANK_CHARGES_CATEGORY },
          update: {},
          create: {
            code: BANK_CHARGES_CATEGORY,
            name: 'Bank charges',
            hint: 'What a bank took to move money between our accounts. Booked automatically when a transfer arrives short — do not file these by hand, or the P&L counts them twice.',
          },
          select: { id: true },
        });
        await this.ledger.post(
          {
            accountId: to.id,
            type: BankEntryType.EXPENSE,
            signedAmount: bankCharge.neg(),
            amountCurrency: to.currency,
            owner: { kind: BankOwnerKind.CAPITAL },
            occurredAt: input.movedAt,
            transferId: transfer.id,
            expenseCategoryId: category.id,
            note: `Bank charge on a transfer from ${from.label}: ${out.toFixed(2)} sent, ${inn.toFixed(2)} arrived`,
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
            bankCharge: bankCharge.gt(0) ? bankCharge.toFixed(2) : null,
            sellerId: input.sellerId ?? null,
          },
        },
        tx,
      );

      return {
        transferId: transfer.id,
        achievedRate: achieved?.toString() ?? null,
        fxSpread: spread?.toFixed(2) ?? null,
        bankCharge: bankCharge.gt(0) ? bankCharge.toFixed(2) : null,
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
