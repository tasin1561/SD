import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
  WalletEntryDirection,
  WithdrawalRequestStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { WithdrawalRequestService } from '../../seller-wallet-withdrawal/services/withdrawal-request.service';
import type { CreateRemittanceDto } from '../dto/create-remittance.dto';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
  isUniqueViolation,
} from '../../treasury/services/bank-ledger.service';
import { BANK_CHARGES_CATEGORY } from '../../treasury/services/bank-transfer.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { AdvisoryLock, takeAdvisoryLock } from '../../../common/db/advisory-lock';

const ZERO = new Prisma.Decimal(0);
const PAISA = new Prisma.Decimal('0.01');

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
    private readonly issues: SystemIssueService,
    private readonly attribution: SellerCashAttributionService,
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
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `remittance ${remittanceId} recorded, but its withdrawal request was not closed: ` +
          message,
      );
      /*
        "A human can still close it" was true and was not enough: no
        human was ever TOLD to. The money has left the bank and the
        seller's request stays APPROVED, so it reads as still owed —
        which is how the same payout gets sent twice.

        Keyed on the remittance, not the seller: one payment that
        half-landed is one problem, and a seller with a second bad
        remittance next month deserves its own row rather than a count
        on an old one somebody already closed.
      */
      // Wrapped, even though `raise` swallows its own failures: this
      // sits INSIDE a catch on a money path, and an alerter that throws
      // there turns a handled problem into an unhandled one — the exact
      // failure the surrounding try exists to prevent. A missing
      // dependency is the realistic way that happens, and it costs one
      // line to make it impossible.
      try {
        void this.issues.raise({
          kind: SystemIssueKind.MONEY,
          severity: SystemIssueSeverity.HIGH,
          title: `Remittance ${remittanceId} paid, but its withdrawal request is still open`,
          detail:
            `The money was sent and recorded. Closing the matching withdrawal request then ` +
            `failed: ${message}\n\n` +
            'Until somebody closes it by hand, that request still reads as owed — which is how ' +
            'the same payout goes out a second time. Open the seller on /withdrawals, check it ' +
            'against this remittance, and mark it paid.',
          source: 'RemittanceService',
          dedupeKey: `remittance-withdrawal-unclosed:${remittanceId}`,
          metadata: { remittanceId, sellerId, amountSent: amountSent.toFixed(2), error: message },
        });
      } catch {
        // Nothing more to do — the log line above already said it.
      }
    }
  }

  async create(
    input: CreateRemittanceDto,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<{ id: string; replayed: boolean }> {
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

    // What the bank took for sending it, in the paying account's currency.
    // Ours, not the seller's: they are owed what they asked for.
    const bankFee =
      input.bankFee === undefined || input.bankFee === null
        ? ZERO
        : new Prisma.Decimal(input.bankFee);

    // A retried request: the same key already recorded this payout. The
    // wallet is not debited again, and the withdrawal it closed stays closed.
    const key = input.idempotencyKey ?? null;
    const replay = async (): Promise<{ id: string; replayed: true } | null> => {
      if (key === null) return null;
      const prior = await this.prisma.client.remittance.findUnique({
        where: { idempotencyKey: key },
        select: {
          id: true,
          sellerId: true,
          currency: true,
          amount: true,
          sourceAmount: true,
          paidFromAccountId: true,
        },
      });
      if (prior === null) return null;
      if (
        prior.sellerId !== input.sellerId ||
        prior.currency !== input.currency ||
        !prior.amount.equals(amount) ||
        !prior.sourceAmount.equals(sourceAmount) ||
        prior.paidFromAccountId !== input.paidFromAccountId
      ) {
        throw idempotencyKeyReused('remittance');
      }
      return { id: prior.id, replayed: true };
    };
    const prior = await replay();
    if (prior !== null) return prior;

    let result: { id: string };
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        // WAL-7: a guard that reads the balance and then debits it holds the
        // wallet's own lock, taken BEFORE the read. Without it two payouts
        // for one seller each read the same balance and both pass.
        await takeAdvisoryLock(
          tx,
          AdvisoryLock.WALLET,
          `${input.sellerId}|${input.sourceCurrency}`,
        );
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
            idempotencyKey: key,
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
        //
        // WHOSE cash left is decided per ACCOUNT, and by VALUE.
        //
        // The wallet falls by `sourceAmount` rupees (S), so what the book
        // holds for the seller must fall by exactly S too (TRE-8):
        //
        //   - From the paying account, their money goes at their AVERAGE
        //     rate there (book ÷ units): up to S of book, and the units that
        //     book buys — all of it, units and book, when it is all spent.
        //   - Whatever of S the paying account does not cover is their money
        //     ELSEWHERE (the ordinary BD payout: COD in rupees at HDFC, paid
        //     in taka from Tasin), which becomes ours, and those taka leave
        //     as ours — valued at THIS payout's own rate (fxRateSnapshot),
        //     which is a fact of this payment the operator stated. There is
        //     always a rate: refusing a payout because the paying account
        //     had no rate of its own stranded the seller's cash as "theirs"
        //     in an account it had left.
        //   - The taka that actually left (amount) against the taka those
        //     two parts are worth is REALISED FX, ours: a capital FX_SPREAD
        //     linked to the payout, which the P&L converts at the payout's
        //     own rate. The account still falls by exactly what the
        //     statement shows.
        const paidAt = new Date(input.paidAt);
        const reference = input.bankReference.trim();
        const sellerOwner = { kind: BankOwnerKind.SELLER, sellerId: input.sellerId } as const;
        const onPayout = { remittanceId: remittance.id } as const;
        await takeAdvisoryLock(
          tx,
          AdvisoryLock.BANK_RECONCILE,
          `${input.paidFromAccountId}|${BankOwnerKind.SELLER}|${input.sellerId}`,
        );
        if (input.sourceCurrency === Currency.INR) {
          const here = await this.bank.sellerBook(
            input.sellerId,
            input.paidFromAccountId,
            input.currency,
            tx,
          );
          let unitsHere = ZERO;
          let bookHere = ZERO;
          if (here.units.gt(0) && here.book.gt(0)) {
            if (here.book.lessThanOrEqualTo(sourceAmount)) {
              unitsHere = here.units;
              bookHere = here.book;
            } else {
              bookHere = sourceAmount;
              unitsHere = sourceAmount.mul(here.units).div(here.book).toDecimalPlaces(2);
              if (unitsHere.gte(here.units)) {
                // Rounding reached every unit while book remains: the last
                // unit keeps the residue, so the holding never reads 0 units
                // with rupees still against it.
                const lessOne = here.units.sub(PAISA);
                if (lessOne.gt(0)) unitsHere = lessOne;
                else {
                  unitsHere = here.units;
                  bookHere = here.book;
                }
              }
            }
          }
          const restInr = sourceAmount.sub(bookHere);
          // The taka the part paid from our own money is worth, at this
          // payout's rate.
          const capitalFair = restInr.gt(0) ? restInr.mul(fxRate).toDecimalPlaces(2) : ZERO;
          const realisedFx = unitsHere.add(capitalFair).sub(amount);
          if (unitsHere.gt(0)) {
            await this.bank.post(
              {
                accountId: input.paidFromAccountId,
                type: BankEntryType.SELLER_WITHDRAWAL,
                signedAmount: unitsHere.neg(),
                amountCurrency: input.currency,
                owner: sellerOwner,
                occurredAt: paidAt,
                reference,
                staffId: actor.staffId,
                note: 'Paid out to the seller',
                inrBookValue: bookHere.neg(),
                ...onPayout,
              },
              tx,
            );
          }
          if (capitalFair.gt(0)) {
            await this.bank.post(
              {
                accountId: input.paidFromAccountId,
                type: BankEntryType.SELLER_WITHDRAWAL,
                signedAmount: capitalFair.neg(),
                amountCurrency: input.currency,
                owner: { kind: BankOwnerKind.CAPITAL },
                occurredAt: paidAt,
                reference,
                staffId: actor.staffId,
                note: 'Paid out to the seller from our money here — their money elsewhere becomes ours',
                ...onPayout,
              },
              tx,
            );
          }
          if (!realisedFx.isZero()) {
            await this.bank.post(
              {
                accountId: input.paidFromAccountId,
                type: BankEntryType.FX_SPREAD,
                signedAmount: realisedFx,
                amountCurrency: input.currency,
                owner: { kind: BankOwnerKind.CAPITAL },
                occurredAt: paidAt,
                reference,
                staffId: actor.staffId,
                note:
                  `Realised FX on remittance ${reference}: ${amount.toFixed(2)} ${input.currency} paid ` +
                  `for ${unitsHere.add(capitalFair).toFixed(2)} of value` +
                  (realisedFx.isNegative() ? ' — covered from capital' : ''),
                ...onPayout,
              },
              tx,
            );
          }
          if (restInr.gt(0)) {
            await this.attribution.takeToCapital(tx, {
              sellerId: input.sellerId,
              amount: restInr,
              reference: remittance.id,
              note: `Paid out from our money on remittance ${reference} — this was theirs`,
            });
          }
        } else {
          // A wallet in the paying currency itself: no rupee anchor to value
          // by, so the seller's part is simply what they hold here, and the
          // rest is ours.
          const heldHere = await this.bank.ownerBalance(input.paidFromAccountId, sellerOwner, tx);
          const sellerUnits = heldHere.lt(amount) ? (heldHere.lt(0) ? ZERO : heldHere) : amount;
          const capitalUnits = amount.sub(sellerUnits);
          if (sellerUnits.gt(0)) {
            await this.bank.post(
              {
                accountId: input.paidFromAccountId,
                type: BankEntryType.SELLER_WITHDRAWAL,
                signedAmount: sellerUnits.neg(),
                amountCurrency: input.currency,
                owner: sellerOwner,
                occurredAt: paidAt,
                reference,
                staffId: actor.staffId,
                note: 'Paid out to the seller',
                ...onPayout,
              },
              tx,
            );
          }
          if (capitalUnits.gt(0)) {
            await this.bank.post(
              {
                accountId: input.paidFromAccountId,
                type: BankEntryType.SELLER_WITHDRAWAL,
                signedAmount: capitalUnits.neg(),
                amountCurrency: input.currency,
                owner: { kind: BankOwnerKind.CAPITAL },
                occurredAt: paidAt,
                reference,
                staffId: actor.staffId,
                note: 'Paid out to the seller from our money here',
                ...onPayout,
              },
              tx,
            );
          }
        }

        if (bankFee.gt(0)) {
          const category = await tx.expenseCategory.upsert({
            where: { code: BANK_CHARGES_CATEGORY },
            update: {},
            create: {
              code: BANK_CHARGES_CATEGORY,
              name: 'Bank charges',
              hint: 'What a bank took to move money. Booked automatically on a transfer that arrives short and on a remittance fee — do not file these by hand, or the P&L counts them twice.',
            },
            select: { id: true },
          });
          await this.bank.post(
            {
              accountId: input.paidFromAccountId,
              type: BankEntryType.EXPENSE,
              signedAmount: bankFee.neg(),
              amountCurrency: input.currency,
              owner: { kind: BankOwnerKind.CAPITAL },
              occurredAt: paidAt,
              reference,
              expenseCategoryId: category.id,
              staffId: actor.staffId,
              note: `Bank fee on remittance ${reference}`,
              ...onPayout,
            },
            tx,
          );
        }

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
    } catch (err) {
      // Two copies of one request racing: the other committed first.
      const raced = isUniqueViolation(err) ? await replay() : null;
      if (raced !== null) return raced;
      throw err;
    }

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
        bankFee: bankFee.gt(0) ? bankFee.toFixed(2) : null,
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

    return { id: result.id, replayed: false };
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
          // WHICH of our accounts the money left. The column has been
          // here since the payout flow was written and was simply never
          // returned, so the page could show a payout without saying
          // where it came from — the one thing needed to match it
          // against a statement.
          paidFromAccount: { select: { label: true, bankName: true, currency: true } },
          staff: { select: { emailDisplay: true } },
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
        // Null for payouts recorded before the account was captured;
        // shown as "not recorded" rather than blank, so an old row and a
        // missing answer stay distinguishable.
        paidFromLabel: r.paidFromAccount?.label ?? null,
        paidFromBank: r.paidFromAccount?.bankName ?? null,
        recordedByName: r.staff?.emailDisplay ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }
}
