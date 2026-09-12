import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { BankLedgerService, idempotencyKeyReused, isUniqueViolation } from './bank-ledger.service';

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
  /** The form's key: a replay returns the original transfer and moves nothing. */
  readonly idempotencyKey?: string | null;
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
 * A quote is honoured only INTO ANOTHER CURRENCY. The taka credited
 * carry, as their book, exactly the rupees that left — so promising
 * ৳1,300 for ₹1,000 costs their wallet nothing and the book still equals
 * it. INTO RUPEES a quote is REFUSED (TRANSFER_QUOTE_INTO_WALLET_CURRENCY):
 * a rupee is worth a rupee to an INR wallet, so crediting the quoted
 * rupees instead of the book value that left moved what the book holds
 * for them by (quote − average) × units while the wallet — which a
 * transfer never touches — stood still.
 *
 * With NO quote the seller's money simply moved. Into taka they are
 * credited what actually arrived, carrying the rupee BOOK value of what
 * left, so their wallet's worth in the book does not change and there is
 * no spread. Into rupees — a rupee holding is its own book — they are
 * credited what the money was worth to their wallet, and the gap against
 * what arrived is a real realised FX, ours. (Inventing an implied quote
 * from "their last top-up rate" on each side booked a phantom FX loss or
 * gain on every such move.)
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

    // A retried request: the same key already recorded this transfer.
    const key = input.idempotencyKey ?? null;
    if (key !== null) {
      const prior = await this.replay(key, input, out, inn);
      if (prior !== null) return prior;
    }

    const [from, to] = await Promise.all([
      this.account(input.fromAccountId),
      this.account(input.toAccountId),
    ]);

    const crossCurrency = from.currency !== to.currency;
    const quoted = input.quotedRate ? new Prisma.Decimal(input.quotedRate) : null;

    // A QUOTE INTO RUPEES HAS NOTHING TO SET, so it is refused — neither
    // obeyed nor silently ignored.
    //
    // A transfer moves a seller's money between our accounts; it never
    // changes what their wallet owes them. Their wallet is in rupees, so
    // money arriving in rupees must be held at exactly the rupee BOOK value
    // of what left (their average in the sending account) — which the
    // no-quote path below does, booking the gap against what arrived as our
    // FX. Obeyed, a quote credits (quote − average) × units more or less
    // than the wallet says and the book stops equalling it (TRE-8). Ignored,
    // an operator believes a promise was honoured that was not. Into taka a
    // quote stays meaningful: the taka carry the rupees that left as their
    // book, so the promise costs the wallet nothing (TRE-5).
    if (input.sellerId && quoted !== null && to.currency === Currency.INR) {
      throw new BadRequestException({
        code: 'TRANSFER_QUOTE_INTO_WALLET_CURRENCY',
        message:
          'A seller’s money moving INTO rupees takes no quoted rate. Their wallet is in rupees, ' +
          'so they are credited exactly what the money that left was worth to it (their average ' +
          'rate in the sending account), and the difference against what arrived is booked as ' +
          'our FX. Leave the quote empty.',
      });
    }

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

    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // The seller's WALLET lock before the reconcile lock below — the
        // order every path that moves a seller's cash takes them in, so a
        // transfer and a charge on the same seller cannot deadlock.
        if (input.sellerId) {
          await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${input.sellerId}|${Currency.INR}`);
        }

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
        // What the seller's money that left is worth to their wallet, in
        // rupees — at their average in the sending account, all of their
        // book there when all of their units go. It arrives carrying
        // exactly that, so a transfer never changes what the book holds
        // for them, only where and in what.
        let valueOut: Prisma.Decimal | null = null;
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
          valueOut = await this.ledger.inrValueOfSellerUnits(
            input.sellerId,
            from.id,
            from.currency,
            out,
            tx,
          );
        }

        // What the owner is credited on the far side.
        //   - Same currency: everything that left (the bank's charge is ours).
        //   - A seller's money with a quote: the QUOTED amount (TRE-5); the
        //     gap against what arrived is FX_SPREAD, ours either way. Only
        //     ever into another currency — a quote into rupees was refused
        //     above, so this never credits rupees off a rate.
        //   - A seller's money, no quote, arriving in RUPEES: what it was
        //     worth to their wallet (valueOut) — a rupee holding is its own
        //     book, so crediting fewer rupees than that would leave the
        //     book short of the wallet. The gap against what arrived is a
        //     real realised FX, ours.
        //   - Otherwise everything that arrived (a seller's taka carries the
        //     book value of what left, so nothing is invented).
        let creditedToSeller: Prisma.Decimal;
        let spread: Prisma.Decimal | null = null;
        if (!crossCurrency) {
          creditedToSeller = out;
        } else if (input.sellerId && quoted !== null) {
          creditedToSeller = out.mul(quoted).toDecimalPlaces(2);
          spread = inn.sub(creditedToSeller);
        } else if (input.sellerId && to.currency === Currency.INR && valueOut !== null) {
          creditedToSeller = valueOut;
          spread = inn.sub(valueOut);
        } else {
          creditedToSeller = inn;
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
            idempotencyKey: key,
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
            ...(valueOut === null ? {} : { inrBookValue: valueOut.neg() }),
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
            ...(valueOut === null ? {} : { inrBookValue: valueOut }),
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
                (quoted !== null
                  ? `Quoted ${quoted.toString()}, achieved ${achieved?.toString() ?? '-'}`
                  : `No quote — their money was worth ₹${creditedToSeller.toFixed(2)}, ₹${inn.toFixed(2)} arrived`) +
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
              sellerValueInr: valueOut?.toFixed(2) ?? null,
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
    } catch (err) {
      // Two copies of one request racing: the other committed first.
      const raced =
        key !== null && isUniqueViolation(err) ? await this.replay(key, input, out, inn) : null;
      if (raced !== null) return raced;
      throw err;
    }
  }

  /**
   * What an already-recorded transfer returned, rebuilt from the rows it
   * wrote. A DIFFERENT transfer under the same key is refused.
   */
  private async replay(
    key: string,
    input: TransferInput,
    out: Prisma.Decimal,
    inn: Prisma.Decimal,
  ): Promise<TransferResult | null> {
    const prior = await this.prisma.client.bankTransfer.findUnique({
      where: { idempotencyKey: key },
      select: {
        id: true,
        fromAccountId: true,
        toAccountId: true,
        amountOut: true,
        amountIn: true,
        currencyOut: true,
        currencyIn: true,
        sellerId: true,
        quotedRate: true,
        achievedRate: true,
        entries: { select: { type: true, signedAmount: true } },
      },
    });
    if (prior === null) return null;
    if (
      prior.fromAccountId !== input.fromAccountId ||
      prior.toAccountId !== input.toAccountId ||
      !prior.amountOut.equals(out) ||
      !prior.amountIn.equals(inn) ||
      (prior.sellerId ?? null) !== (input.sellerId ?? null)
    ) {
      throw idempotencyKeyReused('transfer');
    }
    const sumOf = (type: BankEntryType): Prisma.Decimal | null => {
      const rows = prior.entries.filter((e) => e.type === type);
      return rows.length === 0 ? null : rows.reduce((t, e) => t.add(e.signedAmount), ZERO);
    };
    const credited = sumOf(BankEntryType.TRANSFER_IN) ?? ZERO;
    const cross = prior.currencyOut !== prior.currencyIn;
    // A spread was computed exactly when the original computed one — a
    // seller's money across a currency, quoted or arriving in rupees —
    // and posted only when it was not zero.
    const spread =
      sumOf(BankEntryType.FX_SPREAD) ??
      (prior.sellerId !== null &&
      cross &&
      (prior.quotedRate !== null || prior.currencyIn === Currency.INR)
        ? ZERO
        : null);
    const charge = sumOf(BankEntryType.EXPENSE);
    return {
      transferId: prior.id,
      achievedRate: prior.achievedRate?.toString() ?? null,
      fxSpread: spread?.toFixed(2) ?? null,
      bankCharge: charge === null ? null : charge.neg().toFixed(2),
      creditedToSeller: credited.toFixed(2),
    };
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
