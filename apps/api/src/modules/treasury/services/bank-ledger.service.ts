import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, BankEntryType, BankOwnerKind, Currency, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  AdvisoryLock,
  ATTRIBUTION_RECONCILE_KEY,
  takeAdvisoryLock,
} from '../../../common/db/advisory-lock';

const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

/**
 * A unique-index violation: for an idempotent create, the sign that a
 * concurrent request with the same key won the race. The caller re-reads
 * by key and replays what the winner recorded.
 */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** The same idempotency key sent with a DIFFERENT request. Refused, never replayed. */
export function idempotencyKeyReused(what: string): ConflictException {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message:
      `This request's idempotency key already recorded a different ${what}. ` +
      'Reopen the form and submit again — a new form gets a new key.',
  });
}

export interface OwnerRef {
  readonly kind: BankOwnerKind;
  /** Required when kind is SELLER — the pair is what makes an account
   *  able to say how much of itself is spoken for, and by whom. */
  readonly sellerId?: string | null;
}

export interface PostEntryInput {
  readonly accountId: string;
  readonly type: BankEntryType;
  /** Negative for money leaving. Always the ACCOUNT's own currency. */
  readonly signedAmount: Prisma.Decimal | string;
  /**
   * What currency `signedAmount` is denominated in.
   *
   * Required, and checked against the account, because the entry is
   * stamped with the ACCOUNT's currency no matter what arrives — so a
   * caller handing over BDT for an INR account would not fail, it would
   * be relabelled, and the book would disagree with the statement by a
   * factor of the exchange rate with nothing to show it happened.
   */
  readonly amountCurrency: Currency;
  readonly owner: OwnerRef;
  /**
   * WHO moved it. Defaults to SYSTEM, which is honest for the paths that
   * have no person behind them — a settlement landing, an attribution
   * pair — and wrong to assume for one that does. A staff-driven post
   * passes STAFF and its `staffId`.
   */
  readonly actorType?: ActorType;
  readonly occurredAt: Date;
  readonly reference?: string | null;
  readonly note?: string | null;
  readonly transferId?: string | null;
  readonly expenseCategoryId?: string | null;
  readonly investmentId?: string | null;
  readonly settlementId?: string | null;
  readonly topupRequestId?: string | null;
  readonly withdrawalRequestId?: string | null;
  /**
   * The consignment freight bill this payment settles.
   *
   * Set ONLY by `InboundFreightService.recordForwarderPayment`, which
   * posts the entry in the same transaction as the cost it belongs to.
   * A linked entry is excluded from the P&L's operating expenses,
   * because that cost is already carried by its own leg — see the
   * column comment in the schema.
   */
  readonly inboundFreightChargeId?: string | null;
  readonly staffId?: string | null;
  /**
   * What a SELLER entry in a non-rupee account is worth to their wallet,
   * in rupees (signed like the amount). Ignored anywhere else. When a
   * SELLER entry in a non-rupee account arrives without one, `post()`
   * values it itself — an outflow at the seller's average rate there, an
   * inflow at today's rate — so no such row is ever left unvalued.
   */
  readonly inrBookValue?: Prisma.Decimal | null;
  /** The payout this entry is part of. */
  readonly remittanceId?: string | null;
  /** The operator declared this the account's opening balance (capital only). */
  readonly isOpeningBalance?: boolean;
  /** The client's key for the request that created it; UNIQUE. */
  readonly idempotencyKey?: string | null;
}

/** What a seller holds in one account: units, and their rupee book value. */
export interface SellerBook {
  readonly units: Prisma.Decimal;
  readonly book: Prisma.Decimal;
}

export interface AccountBalance {
  readonly accountId: string;
  readonly currency: Currency;
  readonly total: string;
  readonly capital: string;
  readonly sellerHeld: string;
  readonly bySeller: ReadonlyArray<{
    readonly sellerId: string;
    readonly companyName: string;
    readonly amount: string;
  }>;
}

/**
 * The only writer of `bank_entries`, and the only place a balance is
 * computed.
 *
 * WHY BALANCES ARE SUMMED, NOT CACHED: the seller wallet cached its
 * balance and left the refresh to each caller — of fourteen money paths,
 * six remembered, and an admin page reported a seller owing ₹3,000 as
 * ₹0.00. Money read wrong is worse than money read slowly, so this sums
 * the entries every time. When a report is genuinely slow, cache it with
 * the newest entry id as the staleness gate — never on a promise that
 * every future writer will remember.
 *
 * WHY SIGNED AMOUNTS: a balance is then a SUM. A debit/credit pair plus
 * a direction column can disagree with itself; a sum cannot.
 *
 * APPEND-ONLY. There is no update or delete path by construction. A
 * mistake is corrected with a RECONCILIATION_ADJUSTMENT that says who
 * corrected it and by how much — which is the difference between a book
 * you can audit and a number somebody changed.
 */
@Injectable()
export class BankLedgerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Post one movement.
   *
   * Takes an optional tx so a caller settling a business event — a
   * settlement, a topup approval — can record the money in the SAME
   * transaction as the event. A bank line that commits without its cause
   * is how a statement stops matching the story.
   */
  /**
   * Attach an existing expense to the consignment freight bill it paid
   * for.
   *
   * ── WHY THIS LIVES HERE AND NOT IN THE FREIGHT SERVICE ───────────────
   * It changes no amount, no account, no owner and no date — the ONLY
   * column it touches is the link. That made it tempting to write from
   * the freight service directly, and the structural guard on TRE-1
   * refused: `bank_entries` has one writer, and "it is only an
   * attribution" is exactly the argument the second writer always makes.
   * Ownership of the table is what keeps every other rule about it
   * enforceable.
   *
   * Guarded on the link still being ABSENT, so two people attributing
   * the same expense from two screens cannot both succeed. Returns
   * whether it claimed it; the caller decides what that means.
   */
  async attributeToFreightCharge(
    entryId: string,
    freightChargeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ claimed: boolean }> {
    const db = tx ?? this.prisma.client;
    const res = await db.bankEntry.updateMany({
      where: { id: entryId, inboundFreightChargeId: null },
      data: { inboundFreightChargeId: freightChargeId },
    });
    return { claimed: res.count > 0 };
  }

  async post(input: PostEntryInput, tx?: Prisma.TransactionClient): Promise<{ id: string }> {
    const db = tx ?? this.prisma.client;
    const amount = new Prisma.Decimal(input.signedAmount);
    if (amount.isZero()) {
      throw new BadRequestException({
        code: 'BANK_ZERO_AMOUNT',
        message: 'A zero movement is not a movement',
      });
    }
    if (input.owner.kind === BankOwnerKind.SELLER && !input.owner.sellerId) {
      throw new BadRequestException({
        code: 'BANK_SELLER_REQUIRED',
        message: 'Money held for a seller must say which seller',
      });
    }
    if (input.owner.kind === BankOwnerKind.CAPITAL && input.owner.sellerId) {
      // Refused rather than ignored: a row that claims both is one
      // somebody will later read as either.
      throw new BadRequestException({
        code: 'BANK_CAPITAL_HAS_SELLER',
        message: 'Capital is ours — it cannot also belong to a seller',
      });
    }

    const account = await db.platformBankAccount.findUnique({
      where: { id: input.accountId },
      select: { id: true, currency: true, deletedAt: true },
    });
    if (!account || account.deletedAt !== null) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }

    if (account.currency !== input.amountCurrency) {
      throw new BadRequestException({
        code: 'BANK_CURRENCY_MISMATCH',
        message:
          `This account is held in ${account.currency}; the amount given is ` +
          `${input.amountCurrency}. Convert it with a transfer, or post to the ` +
          `account the money actually moved through.`,
      });
    }

    // A seller's money in a non-rupee account always carries its rupee
    // book value: summed, it is what their wallet holds for that money,
    // and a charge takes units at book ÷ units. Valued here when the
    // caller did not, so no path — an operator's raw entry, a correction
    // — can leave a row the book cannot count.
    let inrBookValue: Prisma.Decimal | null = null;
    const sellerId = input.owner.sellerId;
    if (
      input.owner.kind === BankOwnerKind.SELLER &&
      sellerId &&
      account.currency !== Currency.INR
    ) {
      inrBookValue =
        input.inrBookValue !== undefined && input.inrBookValue !== null
          ? new Prisma.Decimal(input.inrBookValue).toDecimalPlaces(2)
          : await this.defaultBookValue(sellerId, input.accountId, account.currency, amount, tx);
    }

    const created = await db.bankEntry.create({
      data: {
        inrBookValue,
        remittanceId: input.remittanceId ?? null,
        isOpeningBalance: input.isOpeningBalance ?? false,
        idempotencyKey: input.idempotencyKey ?? null,
        // Named rather than inferred from the staff id: a null there
        // could mean the system or could mean nobody knows, and a bank
        // book must not leave that open.
        actorType: input.actorType ?? (input.staffId == null ? ActorType.SYSTEM : ActorType.STAFF),
        accountId: input.accountId,
        type: input.type,
        signedAmount: amount,
        // Never converted. The column matches the statement, always.
        currency: account.currency,
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        transferId: input.transferId ?? null,
        expenseCategoryId: input.expenseCategoryId ?? null,
        investmentId: input.investmentId ?? null,
        settlementId: input.settlementId ?? null,
        topupRequestId: input.topupRequestId ?? null,
        withdrawalRequestId: input.withdrawalRequestId ?? null,
        inboundFreightChargeId: input.inboundFreightChargeId ?? null,
        reference: input.reference ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
        createdByStaffId: input.staffId ?? null,
      },
      select: { id: true },
    });
    return created;
  }

  /**
   * What a seller holds in one account: its units, and what those units
   * are worth to their wallet in rupees. A rupee account is its own book.
   */
  async sellerBook(
    sellerId: string,
    accountId: string,
    currency: Currency,
    tx?: Prisma.TransactionClient,
  ): Promise<SellerBook> {
    const agg = await (tx ?? this.prisma.client).bankEntry.aggregate({
      where: { accountId, ownerKind: BankOwnerKind.SELLER, sellerId },
      _sum: { signedAmount: true, inrBookValue: true },
    });
    const units = agg._sum.signedAmount ?? ZERO;
    return { units, book: currency === Currency.INR ? units : (agg._sum.inrBookValue ?? ZERO) };
  }

  /**
   * What `units` of a seller's money in this account are worth to their
   * wallet, in rupees.
   *
   * At their weighted-average rate (book ÷ units) while they hold some
   * there — and ALL of the book when all of the units go, so a spent
   * holding is exactly 0 units and ₹0. At today's rate when they hold
   * none. Null when there is neither: the money cannot be valued.
   */
  async inrValueOfSellerUnits(
    sellerId: string,
    accountId: string,
    currency: Currency,
    units: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal | null> {
    if (currency === Currency.INR) return units;
    const held = await this.sellerBook(sellerId, accountId, currency, tx);
    if (held.units.gt(0) && held.book.gt(0)) {
      return units.equals(held.units)
        ? held.book
        : units.mul(held.book).div(held.units).toDecimalPlaces(2);
    }
    const rate = await this.currentInrPerUnit(currency, tx);
    return rate === null ? null : units.mul(rate).toDecimalPlaces(2);
  }

  /** Rupees per unit of `currency` at the system rate, or null when there is none. */
  async currentInrPerUnit(
    currency: Currency,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal | null> {
    if (currency === Currency.INR) return ONE;
    const fx = await (tx ?? this.prisma.client).fxRate.findFirst({
      where: {
        OR: [
          { fromCurrency: currency, toCurrency: Currency.INR },
          { fromCurrency: Currency.INR, toCurrency: currency },
        ],
      },
      select: { fromCurrency: true, rate: true },
    });
    if (!fx || fx.rate.lessThanOrEqualTo(0)) return null;
    // "1 fromCurrency = rate toCurrency".
    return fx.fromCurrency === currency ? fx.rate : ONE.div(fx.rate);
  }

  /**
   * The book value of a SELLER entry nobody valued: money leaving goes at
   * their average there (all of the book when all of the units go);
   * money arriving at today's rate. Null only when there is no rate.
   */
  private async defaultBookValue(
    sellerId: string,
    accountId: string,
    currency: Currency,
    amount: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal | null> {
    if (amount.lessThan(0)) {
      const held = await this.sellerBook(sellerId, accountId, currency, tx);
      if (held.units.gt(0) && held.book.gt(0)) {
        const out = amount.neg();
        return (
          out.greaterThanOrEqualTo(held.units)
            ? held.book
            : out.mul(held.book).div(held.units).toDecimalPlaces(2)
        ).neg();
      }
    }
    const rate = await this.currentInrPerUnit(currency, tx);
    return rate === null ? null : amount.mul(rate).toDecimalPlaces(2);
  }

  /** Every account with its balance, split by whose money it is. */
  async balances(): Promise<AccountBalance[]> {
    const accounts = await this.prisma.client.platformBankAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, currency: true },
      orderBy: { displayOrder: 'asc' },
    });
    if (accounts.length === 0) return [];

    const grouped = await this.prisma.client.bankEntry.groupBy({
      by: ['accountId', 'ownerKind', 'sellerId'],
      _sum: { signedAmount: true },
    });
    const sellerIds = [
      ...new Set(grouped.map((g) => g.sellerId).filter((s): s is string => s !== null)),
    ];
    const sellers = await this.prisma.client.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, companyName: true },
    });
    const nameOf = new Map(sellers.map((s) => [s.id, s.companyName]));

    return accounts.map((a) => {
      const rows = grouped.filter((g) => g.accountId === a.id);
      let capital = ZERO;
      let sellerHeld = ZERO;
      const bySeller: Array<{ sellerId: string; companyName: string; amount: string }> = [];

      for (const r of rows) {
        const sum = r._sum.signedAmount ?? ZERO;
        if (r.ownerKind === BankOwnerKind.CAPITAL) {
          capital = capital.add(sum);
          continue;
        }
        sellerHeld = sellerHeld.add(sum);
        if (r.sellerId !== null) {
          bySeller.push({
            sellerId: r.sellerId,
            companyName: nameOf.get(r.sellerId) ?? 'Unknown seller',
            amount: sum.toFixed(2),
          });
        }
      }
      // Largest holding first: the question asked of this list is
      // "whose money is in here", and that is answered by the top rows.
      bySeller.sort((x, y) => Number(y.amount) - Number(x.amount));

      return {
        accountId: a.id,
        currency: a.currency,
        total: capital.add(sellerHeld).toFixed(2),
        capital: capital.toFixed(2),
        sellerHeld: sellerHeld.toFixed(2),
        bySeller,
      };
    });
  }

  /**
   * What we hold for one seller, per account.
   *
   * The question a payout asks: is their money in one place, and is that
   * place the currency we are paying from.
   */
  async holdingsForSeller(
    sellerId: string,
  ): Promise<Array<{ accountId: string; label: string; currency: Currency; amount: string }>> {
    const rows = await this.prisma.client.bankEntry.groupBy({
      by: ['accountId'],
      where: { sellerId, ownerKind: BankOwnerKind.SELLER },
      _sum: { signedAmount: true },
    });
    if (rows.length === 0) return [];
    const accounts = await this.prisma.client.platformBankAccount.findMany({
      where: { id: { in: rows.map((r) => r.accountId) } },
      select: { id: true, label: true, currency: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return rows
      .map((r) => {
        const a = byId.get(r.accountId);
        return {
          accountId: r.accountId,
          label: a?.label ?? 'Unknown account',
          currency: a?.currency ?? Currency.INR,
          amount: (r._sum.signedAmount ?? ZERO).toFixed(2),
        };
      })
      .filter((r) => Number(r.amount) !== 0);
  }

  /**
   * A human correcting the book against a real statement.
   *
   * Posts the DIFFERENCE as an entry rather than setting the balance.
   * Overwriting would make the discrepancy disappear instead of being
   * investigated, and a bank book whose history can be edited is not
   * evidence of anything.
   */
  async reconcile(input: {
    accountId: string;
    owner: OwnerRef;
    statedBalance: Prisma.Decimal | string;
    reason: string;
    staffId: string;
    /**
     * The operator says this is the account's OPENING balance — money the
     * business already had, not a correction. The P&L leaves exactly the
     * marked entry off the reconciliation line. Capital only, and once per
     * account.
     */
    isOpeningBalance?: boolean;
  }): Promise<{ delta: string; entryId: string | null }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'BANK_REASON_TOO_SHORT',
        message: 'Say why the book was wrong — at least 10 characters',
      });
    }
    const opening = input.isOpeningBalance === true;
    if (opening && input.owner.kind !== BankOwnerKind.CAPITAL) {
      throw new BadRequestException({
        code: 'OPENING_BALANCE_CAPITAL_ONLY',
        message:
          'An opening balance is what the business already had — our own money. A seller’s ' +
          'money arrives through a top-up or a settlement, each of which records why.',
      });
    }
    // ── Read and write under ONE lock, in ONE transaction ───────────
    //
    // This computes a correction from a balance it just read. Read
    // outside the write and two operators reconciling the same account
    // both see the same figure, both post the same difference, and the
    // account ends up corrected twice — permanently, because the ledger
    // is append-only.
    //
    // The per-(account, owner) key: reconciling our capital and a seller's
    // holding in the same account are independent sums and need not queue
    // behind each other.
    //
    // Then the ATTRIBUTION key. Wallet charges and refunds move cash
    // between a seller and capital with reclassification pairs, and every
    // such pair takes this same key (after its seller's WALLET lock). So
    // no pair can land between the balance read below and the correction
    // posted from it — without it, a charge landing mid-reconcile was
    // folded into the adjustment as though it were an error. One key for
    // all accounts rather than one per account, because an attribution
    // that touches two accounts in opposite orders to another would
    // otherwise deadlock with it. Reconcile takes no WALLET lock, and
    // nothing takes a WALLET lock after this key, so there is no cycle.
    const ownerKey = `${input.accountId}|${input.owner.kind}|${input.owner.sellerId ?? ''}`;
    let result: {
      entry: { id: string };
      current: Prisma.Decimal;
      stated: Prisma.Decimal;
      delta: Prisma.Decimal;
    } | null;
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        await takeAdvisoryLock(tx, AdvisoryLock.BANK_RECONCILE, ownerKey);
        await takeAdvisoryLock(tx, AdvisoryLock.BANK_RECONCILE, ATTRIBUTION_RECONCILE_KEY);

        if (opening) {
          const existing = await tx.bankEntry.findFirst({
            where: { accountId: input.accountId, isOpeningBalance: true },
            select: { occurredAt: true },
          });
          if (existing) throw openingBalanceExists(existing.occurredAt);
        }

        const current = await this.ownerBalance(input.accountId, input.owner, tx);
        const stated = new Prisma.Decimal(input.statedBalance);
        const delta = stated.sub(current);
        if (delta.isZero()) return null;

        // The statement being reconciled against IS this account's, so the
        // difference is in its currency by construction.
        const account = await tx.platformBankAccount.findUniqueOrThrow({
          where: { id: input.accountId },
          select: { currency: true },
        });

        const entry = await this.post(
          {
            accountId: input.accountId,
            type: BankEntryType.RECONCILIATION_ADJUSTMENT,
            signedAmount: delta,
            amountCurrency: account.currency,
            owner: input.owner,
            occurredAt: new Date(),
            note: input.reason,
            staffId: input.staffId,
            isOpeningBalance: opening,
          },
          tx,
        );
        return { entry, current, stated, delta };
      });
    } catch (err) {
      // The partial unique on the mark: an opening balance written by
      // account creation at the same moment. Same answer as the check.
      if (opening && isUniqueViolation(err)) throw openingBalanceExists(null);
      throw err;
    }

    if (result === null) return { delta: '0.00', entryId: null };
    const { entry, current, stated, delta } = result;

    await this.audit.log({
      actorType: 'STAFF',
      staffUserId: input.staffId,
      action: 'staff.bank_account.reconciled',
      entityType: 'platform_bank_account',
      entityId: input.accountId,
      // A book that disagreed with the bank is worth a person's
      // attention even after it is corrected.
      severity: 'HIGH',
      metadata: {
        was: current.toFixed(2),
        stated: stated.toFixed(2),
        delta: delta.toFixed(2),
        ownerKind: input.owner.kind,
        sellerId: input.owner.sellerId ?? null,
        reason: input.reason,
        isOpeningBalance: opening,
      },
    });
    return { delta: delta.toFixed(2), entryId: entry.id };
  }

  /**
   * Money the OWNER put into the business, or took out of it — equity.
   *
   * Not a reconciliation. A reconciliation says the book was WRONG, and
   * the P&L reads a positive one as money we did not know we had — so an
   * injection recorded that way read as profit (a ৳100,000 "Initial
   * Balance" did, as ₹81,300.81) and a drawing read as a loss. Its own
   * entry types keep it off every P&L line. Capital only, in the
   * account's own currency, dated when it happened, audited HIGH.
   */
  async recordOwnerMoney(input: {
    accountId: string;
    direction: 'IN' | 'OUT';
    amount: Prisma.Decimal | string;
    occurredAt: Date;
    reason: string;
    reference?: string;
    staffId: string;
    /** The form's key: a replay returns the original entry and posts nothing. */
    idempotencyKey?: string;
  }): Promise<{ id: string }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'BANK_REASON_TOO_SHORT',
        message: 'Say what the money was for — at least 10 characters',
      });
    }
    const amount = new Prisma.Decimal(input.amount);
    const type =
      input.direction === 'IN' ? BankEntryType.OWNER_CONTRIBUTION : BankEntryType.OWNER_DRAWING;
    const key = input.idempotencyKey;
    // A replay: the same key already recorded this. Same request ⇒ the
    // same answer and nothing posted; a DIFFERENT request under the same
    // key is refused rather than silently answered with somebody else's.
    const replay = async (): Promise<{ id: string } | null> => {
      if (key === undefined) return null;
      const prior = await this.prisma.client.bankEntry.findUnique({
        where: { idempotencyKey: key },
        select: { id: true, accountId: true, type: true, signedAmount: true },
      });
      if (prior === null) return null;
      if (
        prior.accountId !== input.accountId ||
        prior.type !== type ||
        !prior.signedAmount.abs().equals(amount)
      ) {
        throw idempotencyKeyReused('owner-money entry');
      }
      return { id: prior.id };
    };
    const replayed = await replay();
    if (replayed !== null) return replayed;
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'OWNER_MONEY_AMOUNT_INVALID',
        message: 'Give the amount as a positive figure; the direction says which way it went',
      });
    }
    if (Number.isNaN(input.occurredAt.getTime())) {
      throw new BadRequestException({ code: 'INVALID_DATE', message: 'When did it happen?' });
    }
    const account = await this.prisma.client.platformBankAccount.findFirst({
      where: { id: input.accountId, deletedAt: null },
      select: { currency: true, label: true },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'BANK_ACCOUNT_NOT_FOUND',
        message: 'No such bank account',
      });
    }
    let entry: { id: string };
    try {
      entry = await this.post({
        accountId: input.accountId,
        type,
        signedAmount: input.direction === 'IN' ? amount : amount.neg(),
        amountCurrency: account.currency,
        owner: { kind: BankOwnerKind.CAPITAL },
        occurredAt: input.occurredAt,
        reference: input.reference ?? null,
        note: input.reason.trim(),
        staffId: input.staffId,
        idempotencyKey: key ?? null,
      });
    } catch (err) {
      // Two copies of one request racing: the other committed first.
      const raced = isUniqueViolation(err) ? await replay() : null;
      if (raced !== null) return raced;
      throw err;
    }
    await this.audit.log({
      actorType: 'STAFF',
      staffUserId: input.staffId,
      action:
        input.direction === 'IN'
          ? 'staff.bank_account.owner_contribution'
          : 'staff.bank_account.owner_drawing',
      entityType: 'platform_bank_account',
      entityId: input.accountId,
      // The owner's own money moving in or out of the business. Not an
      // error being corrected, but a figure that changes what the
      // business is worth — worth a person's attention.
      severity: 'HIGH',
      metadata: {
        account: account.label,
        amount: amount.toFixed(2),
        currency: account.currency,
        occurredAt: input.occurredAt.toISOString(),
        reason: input.reason.trim(),
        entryId: entry.id,
      },
    });
    return entry;
  }

  /**
   * Correct WHOSE the cash in one account is — between a seller and our
   * capital — without moving any of it.
   *
   * For an attribution the bank book got wrong: a charge that was never
   * reclassified, a debt repaid from cash that stayed "held for the
   * seller". A zero-sum PAIR (TRE-8), so the account total — the figure
   * the statement proves — cannot move. A reconciliation is the wrong
   * instrument: it posts ONE owner's difference, which does change the
   * total. Never more than the giving side actually holds in that
   * account: this relabels cash, it cannot invent any.
   */
  async reclassifySellerCash(input: {
    accountId: string;
    sellerId: string;
    direction: 'TO_CAPITAL' | 'TO_SELLER';
    amount: Prisma.Decimal | string;
    reason: string;
    staffId: string;
  }): Promise<{ entryIds: string[] }> {
    if (input.reason.trim().length < 10) {
      throw new BadRequestException({
        code: 'BANK_REASON_TOO_SHORT',
        message: 'Say why the attribution was wrong — at least 10 characters',
      });
    }
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException({
        code: 'RECLASSIFY_AMOUNT_INVALID',
        message: 'Give the amount as a positive figure; the direction says which way it goes',
      });
    }
    const seller: OwnerRef = { kind: BankOwnerKind.SELLER, sellerId: input.sellerId };
    const capital: OwnerRef = { kind: BankOwnerKind.CAPITAL };
    const giver = input.direction === 'TO_CAPITAL' ? seller : capital;
    const taker = input.direction === 'TO_CAPITAL' ? capital : seller;

    const result = await this.prisma.client.$transaction(async (tx) => {
      // The seller's WALLET lock first, then the reconcile locks. Every
      // wallet write takes the wallet lock and its attribution then moves
      // this seller's cash; seller transfers and remittances take the two
      // in this same order. Taken the other way round, a correction and a
      // charge landing together could each hold one and wait for the other.
      await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${input.sellerId}|${Currency.INR}`);
      // Reads a balance and writes from it: both owners' reconcile locks,
      // in a fixed order so two corrections cannot wait on each other.
      const keys = [seller, capital]
        .map((o) => `${input.accountId}|${o.kind}|${o.sellerId ?? ''}`)
        .sort();
      for (const k of keys) await takeAdvisoryLock(tx, AdvisoryLock.BANK_RECONCILE, k);

      const account = await tx.platformBankAccount.findFirst({
        where: { id: input.accountId, deletedAt: null },
        select: { currency: true, label: true },
      });
      if (!account) {
        throw new NotFoundException({
          code: 'BANK_ACCOUNT_NOT_FOUND',
          message: 'No such bank account',
        });
      }
      const exists = await tx.seller.findUnique({
        where: { id: input.sellerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
      }
      const held = await this.ownerBalance(input.accountId, giver, tx);
      if (held.lessThan(amount)) {
        throw new BadRequestException({
          code: 'RECLASSIFY_EXCEEDS_HELD',
          message:
            `${input.direction === 'TO_CAPITAL' ? 'The seller' : 'Our capital'} holds only ` +
            `${held.toFixed(2)} ${account.currency} in ${account.label} — a correction cannot move more than is there.`,
        });
      }
      const base = {
        accountId: input.accountId,
        type: BankEntryType.RECLASSIFICATION,
        amountCurrency: account.currency,
        occurredAt: new Date(),
        note: input.reason.trim(),
        staffId: input.staffId,
      } as const;
      const out = await this.post({ ...base, signedAmount: amount.neg(), owner: giver }, tx);
      const inn = await this.post({ ...base, signedAmount: amount, owner: taker }, tx);
      return { entryIds: [out.id, inn.id], held, account };
    });

    await this.audit.log({
      actorType: 'STAFF',
      staffUserId: input.staffId,
      action: 'staff.bank_account.seller_cash_reclassified',
      entityType: 'platform_bank_account',
      entityId: input.accountId,
      // Changes what the bank book says a seller is owed in cash.
      severity: 'HIGH',
      metadata: {
        account: result.account.label,
        sellerId: input.sellerId,
        direction: input.direction,
        amount: amount.toFixed(2),
        currency: result.account.currency,
        giverHeldBefore: result.held.toFixed(2),
        reason: input.reason.trim(),
        entryIds: result.entryIds,
      },
    });
    return { entryIds: result.entryIds };
  }

  /**
   * What this owner holds in this account, right now.
   *
   * PUBLIC so a caller can ask before it moves money — `reconcile` is no
   * longer the only thing that needs the figure. A caller doing that
   * MUST hold `AdvisoryLock.BANK_RECONCILE` on the same
   * `account|kind|seller` key inside the same transaction (TRE-1): a
   * balance read outside the write that depends on it is not a guard,
   * because two operators both read the same figure and both proceed.
   */
  async ownerBalance(
    accountId: string,
    owner: OwnerRef,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const agg = await (tx ?? this.prisma.client).bankEntry.aggregate({
      where: {
        accountId,
        ownerKind: owner.kind,
        ...(owner.kind === BankOwnerKind.SELLER && owner.sellerId
          ? { sellerId: owner.sellerId }
          : {}),
      },
      _sum: { signedAmount: true },
    });
    return agg._sum.signedAmount ?? ZERO;
  }
}

/** An account's opening balance is recorded once; a second is a correction, not an opening. */
function openingBalanceExists(at: Date | null): ConflictException {
  return new ConflictException({
    code: 'OPENING_BALANCE_EXISTS',
    message:
      'This account already has an opening balance' +
      (at === null ? '' : ` (recorded ${at.toISOString().slice(0, 10)})`) +
      '. Reconcile without marking it: a later difference is a correction, not an opening.',
  });
}
