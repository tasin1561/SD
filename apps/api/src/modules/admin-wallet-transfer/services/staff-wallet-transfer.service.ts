import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  BankEntryType,
  BankOwnerKind,
  Currency,
  Prisma,
  SellerStatus,
  WalletEntryDirection,
} from '@skydrop/db';
import {
  AdvisoryLock,
  lockAccountsForPosting,
  takeAdvisoryLock,
} from '../../../common/db/advisory-lock';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import {
  BankLedgerService,
  idempotencyKeyReused,
  isUniqueViolation,
} from '../../treasury/services/bank-ledger.service';
import { SellerCashAttributionService } from '../../treasury/services/seller-cash-attribution.service';

type TxClient = Prisma.TransactionClient;

const ZERO = new Prisma.Decimal(0);
const MIN_REASON = 20;
const MAX_REASON = 500;
const AUDIT_ACTION = 'staff.wallet_transfer.posted';
/** Who may be debited or credited: a seller who trades, or did and is paused. */
const TRANSFERABLE: readonly SellerStatus[] = [SellerStatus.APPROVED, SellerStatus.SUSPENDED];

export type StaffTransferDirection = 'DEBIT' | 'CREDIT';

export interface StaffTransferInput {
  readonly sellerId: string;
  readonly direction: StaffTransferDirection;
  readonly amountInr: string;
  readonly bankAccountId?: string | null;
  readonly reason: string;
  readonly internalNote?: string | null;
  readonly idempotencyKey?: string;
  readonly staffId: string;
}

/** One account the transfer touches, before and after. Units are the account's currency. */
export interface StaffTransferAccountMove {
  readonly accountId: string;
  readonly label: string;
  readonly currency: Currency;
  /** Units changing hands: out of the seller's pot on a debit, into it on a credit. */
  readonly units: string;
  /** What those units are worth to the wallet, in rupees. */
  readonly inr: string;
  readonly sellerBefore: string;
  readonly sellerAfter: string;
  readonly capitalBefore: string;
  readonly capitalAfter: string;
}

export interface StaffTransferPreview {
  readonly sellerId: string;
  readonly companyName: string;
  readonly direction: StaffTransferDirection;
  readonly amountInr: string;
  readonly walletBeforeInr: string;
  readonly walletAfterInr: string;
  /** What the bank book holds for the seller, every currency at its rupee book value. */
  readonly heldBeforeInr: string;
  readonly heldAfterInr: string;
  /** Rupees of cash that change owner. */
  readonly cashMovedInr: string;
  /**
   * The part of the amount no cash moves for. On a debit: what the seller
   * will owe us beyond what they hold (a receivable). On a credit: what
   * clears a debt they already owed.
   */
  readonly withoutCashInr: string;
  readonly accounts: readonly StaffTransferAccountMove[];
  /** A plain sentence of what will happen, for the confirm step. */
  readonly sentence: string;
}

export interface StaffTransferResult {
  readonly walletEntryId: string;
  readonly replayed: boolean;
  readonly walletAfterInr: string;
  /** Null on a replay — the figures are those of the original, already recorded. */
  readonly preview: StaffTransferPreview | null;
}

export interface StaffTransferRow {
  readonly id: string;
  readonly sellerId: string;
  readonly companyName: string;
  readonly direction: StaffTransferDirection;
  readonly amountInr: string;
  readonly walletAfterInr: string;
  readonly reason: string | null;
  readonly internalNote: string | null;
  readonly staff: string | null;
  readonly accounts: ReadonlyArray<{ readonly label: string; readonly amount: string }>;
  readonly createdAt: Date;
}

/**
 * A member of staff moving money between a seller's wallet and us, on
 * purpose, with a reason the seller reads.
 *
 * NOT an adjustment. ADJUSTMENT_* correct a wallet and move no cash,
 * because whether cash was implicated is exactly what is being corrected.
 * These MOVE it (TRE-8):
 *
 *   - DEBIT (`STAFF_DEBIT`): the wallet falls by X and the seller's held
 *     cash becomes capital exactly as a charge does — clamped to what they
 *     hold, rupees first and then other currencies at their book value.
 *     What they do not hold is a receivable: their wallet goes negative and
 *     NO bank entry is invented for it.
 *   - CREDIT (`STAFF_CREDIT`): the wallet rises by X. The part that clears
 *     a debt they owed repays a receivable and moves no cash (`debtSplit`,
 *     as every cash-in does); the rest is our capital in the chosen rupee
 *     account becoming theirs, as a zero-sum pair. Held cash stays equal to
 *     max(0, wallet).
 *
 * Locks, in the one order every money writer uses: the seller's WALLET,
 * then the reconcile key of every account touched, then (inside the
 * attribution pair) ATTRIBUTION_RECONCILE_KEY.
 */
@Injectable()
export class StaffWalletTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly ledger: BankLedgerService,
    private readonly cash: SellerCashAttributionService,
    private readonly audit: AuditLogService,
  ) {}

  /** What the transfer would do, computed under the same locks and walk, writing nothing. */
  async preview(input: StaffTransferInput): Promise<StaffTransferPreview> {
    const amount = this.validate(input);
    return this.prisma.client.$transaction(async (tx) => {
      const ctx = await this.lockAndLoad(tx, input);
      return this.compute(tx, input, amount, ctx);
    });
  }

  async execute(input: StaffTransferInput): Promise<StaffTransferResult> {
    const amount = this.validate(input);
    const replayed = await this.replay(input, amount);
    if (replayed !== null) return replayed;

    let done: { entryId: string; walletAfter: Prisma.Decimal; preview: StaffTransferPreview };
    try {
      done = await this.prisma.client.$transaction(async (tx) => {
        const ctx = await this.lockAndLoad(tx, input);
        const preview = await this.compute(tx, input, amount, ctx);
        const reason = input.reason.trim();
        const entry = await this.wallet.applyEntry(tx, {
          sellerId: input.sellerId,
          currency: Currency.INR,
          direction:
            input.direction === 'DEBIT'
              ? WalletEntryDirection.STAFF_DEBIT
              : WalletEntryDirection.STAFF_CREDIT,
          amount,
          // The note IS what the seller reads on their ledger.
          note: reason,
          reasonCode: 'STAFF_TRANSFER',
          actorType: ActorType.STAFF,
          actorId: input.staffId,
          idempotencyKey: input.idempotencyKey ?? null,
        });
        // A debit's cash moved inside applyEntry (the charge path). A
        // credit's moves here, in the account the operator chose: only the
        // part that lifts the wallet above zero.
        if (input.direction === 'CREDIT' && ctx.accountId !== null) {
          await this.cash.giveFromCapital(tx, {
            sellerId: input.sellerId,
            accountId: ctx.accountId,
            amount: new Prisma.Decimal(preview.cashMovedInr),
            reference: entry.id,
            note: `Credited by Skydrop — ${reason}`,
          });
        }
        return { entryId: entry.id, walletAfter: entry.runningBalanceAfter, preview };
      });
    } catch (err) {
      // Two copies of one form racing: the other committed first.
      const raced = isUniqueViolation(err) ? await this.replay(input, amount) : null;
      if (raced !== null) return raced;
      throw err;
    }

    await this.audit.log({
      actorType: 'STAFF',
      staffUserId: input.staffId,
      action: AUDIT_ACTION,
      entityType: 'seller_wallet_entry',
      entityId: done.entryId,
      // Real money moving between a seller and us on one person's word.
      severity: 'HIGH',
      metadata: {
        sellerId: input.sellerId,
        direction: input.direction,
        amountInr: amount.toFixed(2),
        reason: input.reason.trim(),
        internalNote: input.internalNote?.trim() || null,
        walletBeforeInr: done.preview.walletBeforeInr,
        walletAfterInr: done.preview.walletAfterInr,
        heldBeforeInr: done.preview.heldBeforeInr,
        heldAfterInr: done.preview.heldAfterInr,
        cashMovedInr: done.preview.cashMovedInr,
        withoutCashInr: done.preview.withoutCashInr,
        accounts: done.preview.accounts.map((a) => ({
          accountId: a.accountId,
          label: a.label,
          units: a.units,
          currency: a.currency,
        })),
      },
    });
    return {
      walletEntryId: done.entryId,
      replayed: false,
      walletAfterInr: done.walletAfter.toFixed(2),
      preview: done.preview,
    };
  }

  /** Past staff transfers, newest first. */
  async list(query: { sellerId?: string; limit?: number }): Promise<{ items: StaffTransferRow[] }> {
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const entries = await this.prisma.client.sellerWalletEntry.findMany({
      where: {
        direction: { in: [WalletEntryDirection.STAFF_DEBIT, WalletEntryDirection.STAFF_CREDIT] },
        ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      },
      orderBy: { id: 'desc' },
      take,
      select: {
        id: true,
        sellerId: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
        note: true,
        actorId: true,
        createdAt: true,
        seller: { select: { companyName: true } },
      },
    });
    if (entries.length === 0) return { items: [] };
    const ids = entries.map((e) => e.id);
    const actorIds = [...new Set(entries.flatMap((e) => (e.actorId === null ? [] : [e.actorId])))];
    const [staff, audits, pairs] = await Promise.all([
      this.prisma.client.staffUser.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, emailDisplay: true },
      }),
      this.prisma.client.auditLog.findMany({
        where: { action: AUDIT_ACTION, entityId: { in: ids } },
        select: { entityId: true, metadata: true },
      }),
      this.prisma.client.bankEntry.findMany({
        where: {
          reference: { in: ids },
          type: BankEntryType.RECLASSIFICATION,
          ownerKind: BankOwnerKind.SELLER,
        },
        select: {
          reference: true,
          signedAmount: true,
          currency: true,
          account: { select: { label: true } },
        },
      }),
    ]);
    const staffBy = new Map(staff.map((s) => [s.id, s.emailDisplay]));
    const noteBy = new Map<string, string | null>();
    for (const a of audits) {
      const m = a.metadata as Record<string, unknown> | null;
      const note = m?.['internalNote'];
      if (a.entityId !== null) noteBy.set(a.entityId, typeof note === 'string' ? note : null);
    }
    return {
      items: entries.map((e) => ({
        id: e.id,
        sellerId: e.sellerId,
        companyName: e.seller.companyName,
        direction: e.direction === WalletEntryDirection.STAFF_DEBIT ? 'DEBIT' : 'CREDIT',
        amountInr: e.amount.toFixed(2),
        walletAfterInr: e.runningBalanceAfter.toFixed(2),
        reason: e.note,
        internalNote: noteBy.get(e.id) ?? null,
        staff: e.actorId === null ? null : (staffBy.get(e.actorId) ?? null),
        accounts: pairs
          .filter((p) => p.reference === e.id)
          .map((p) => ({
            label: p.account.label,
            amount: `${p.signedAmount.abs().toFixed(2)} ${p.currency}`,
          })),
        createdAt: e.createdAt,
      })),
    };
  }

  /** Sellers a transfer can be made to, by name or email. */
  async searchSellers(
    q: string,
  ): Promise<{ items: Array<{ id: string; companyName: string; email: string }> }> {
    const term = q.trim();
    const rows = await this.prisma.client.seller.findMany({
      where: {
        deletedAt: null,
        status: { in: [...TRANSFERABLE] },
        ...(term === ''
          ? {}
          : {
              OR: [
                { companyName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
              ],
            }),
      },
      orderBy: { companyName: 'asc' },
      take: 20,
      select: { id: true, companyName: true, email: true },
    });
    return { items: rows };
  }

  /**
   * What the form needs before a preview: the seller's wallet and holdings,
   * and every rupee account with what is ours and what is theirs in it.
   */
  async context(sellerId: string): Promise<{
    seller: { id: string; companyName: string; status: SellerStatus };
    walletInr: string;
    heldInr: string;
    accounts: Array<{ accountId: string; label: string; capitalInr: string; sellerInr: string }>;
  }> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, companyName: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
    }
    const [last, holdings, accounts] = await Promise.all([
      this.prisma.client.sellerWalletEntry.findFirst({
        where: { sellerId, currency: Currency.INR },
        orderBy: { id: 'desc' },
        select: { runningBalanceAfter: true },
      }),
      this.prisma.client.bankEntry.groupBy({
        by: ['accountId', 'currency'],
        where: { sellerId, ownerKind: BankOwnerKind.SELLER, account: { deletedAt: null } },
        _sum: { signedAmount: true, inrBookValue: true },
      }),
      this.prisma.client.platformBankAccount.findMany({
        where: { currency: Currency.INR, deletedAt: null },
        orderBy: { displayOrder: 'asc' },
        select: { id: true, label: true },
      }),
    ]);
    const held = holdings.reduce((t, h) => {
      const units = h._sum.signedAmount ?? ZERO;
      const book = h.currency === Currency.INR ? units : (h._sum.inrBookValue ?? ZERO);
      return units.greaterThan(0) ? t.add(book) : t;
    }, ZERO);
    const rows = await Promise.all(
      accounts.map(async (a) => ({
        accountId: a.id,
        label: a.label,
        capitalInr: (await this.ledger.ownerBalance(a.id, { kind: BankOwnerKind.CAPITAL })).toFixed(
          2,
        ),
        sellerInr: (
          await this.ledger.ownerBalance(a.id, { kind: BankOwnerKind.SELLER, sellerId })
        ).toFixed(2),
      })),
    );
    return {
      seller,
      walletInr: (last?.runningBalanceAfter ?? ZERO).toFixed(2),
      heldInr: held.toFixed(2),
      accounts: rows,
    };
  }

  // ── internals ─────────────────────────────────────────────────────────

  /** The shape of a request. Refused before anything is read. */
  private validate(input: StaffTransferInput): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(input.amountInr);
    } catch {
      throw new BadRequestException({
        code: 'WALLET_TRANSFER_AMOUNT_INVALID',
        message: 'Give the amount in rupees, as a positive figure.',
      });
    }
    if (amount.lessThanOrEqualTo(0) || !amount.equals(amount.toDecimalPlaces(2))) {
      throw new BadRequestException({
        code: 'WALLET_TRANSFER_AMOUNT_INVALID',
        message: 'Give the amount in rupees, as a positive figure with at most two decimals.',
      });
    }
    const reason = input.reason.trim();
    if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
      throw new BadRequestException({
        code: 'WALLET_TRANSFER_REASON_TOO_SHORT',
        message: `The seller reads this reason on their wallet — write ${MIN_REASON} to ${MAX_REASON} characters.`,
      });
    }
    if (input.direction === 'CREDIT' && !input.bankAccountId) {
      throw new BadRequestException({
        code: 'WALLET_TRANSFER_ACCOUNT_REQUIRED',
        message: 'Say which of our rupee accounts the money comes from.',
      });
    }
    if (input.direction === 'DEBIT' && input.bankAccountId) {
      throw new BadRequestException({
        code: 'WALLET_TRANSFER_ACCOUNT_NOT_FOR_DEBIT',
        message:
          'A debit takes the seller’s money where it already sits with us — do not name an account.',
      });
    }
    return amount;
  }

  /**
   * The seller's WALLET lock first, then the reconcile key of every account
   * the transfer can touch (sorted), and only then the reads it decides
   * from. The attribution pair takes ATTRIBUTION_RECONCILE_KEY after these.
   */
  private async lockAndLoad(
    tx: TxClient,
    input: StaffTransferInput,
  ): Promise<{ companyName: string; accountId: string | null }> {
    await takeAdvisoryLock(tx, AdvisoryLock.WALLET, `${input.sellerId}|${Currency.INR}`);
    const seller = await tx.seller.findFirst({
      where: { id: input.sellerId, deletedAt: null },
      select: { companyName: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'No such seller' });
    }
    if (!TRANSFERABLE.includes(seller.status)) {
      throw new ConflictException({
        code: 'WALLET_TRANSFER_SELLER_NOT_ACTIVE',
        message: `${seller.companyName} is ${seller.status.toLowerCase()} — only an approved or suspended seller's wallet can be moved.`,
      });
    }
    if (input.direction === 'CREDIT') {
      const accountId = input.bankAccountId ?? '';
      const account = await tx.platformBankAccount.findFirst({
        where: { id: accountId, deletedAt: null },
        select: { currency: true, label: true },
      });
      if (!account) {
        throw new NotFoundException({
          code: 'BANK_ACCOUNT_NOT_FOUND',
          message: 'No such bank account, or it has been retired.',
        });
      }
      if (account.currency !== Currency.INR) {
        throw new BadRequestException({
          code: 'WALLET_TRANSFER_ACCOUNT_NOT_INR',
          message: `${account.label} is held in ${account.currency}. The wallet is in rupees — credit from a rupee account.`,
        });
      }
      await lockAccountsForPosting(tx, [accountId]);
      return { companyName: seller.companyName, accountId };
    }
    const holdings = await this.cash.sellerHoldings(tx, input.sellerId);
    await lockAccountsForPosting(
      tx,
      holdings.map((h) => h.accountId),
    );
    return { companyName: seller.companyName, accountId: null };
  }

  /** The figures, read under the locks `lockAndLoad` took. */
  private async compute(
    tx: TxClient,
    input: StaffTransferInput,
    amount: Prisma.Decimal,
    ctx: { companyName: string; accountId: string | null },
  ): Promise<StaffTransferPreview> {
    const walletBefore = await this.cash.walletBalance(tx, input.sellerId);
    const holdings = await this.cash.sellerHoldings(tx, input.sellerId);
    const heldBefore = holdings.reduce((t, h) => t.add(h.book), ZERO);

    let cashMoved: Prisma.Decimal;
    let moves: Array<{
      accountId: string;
      currency: Currency;
      units: Prisma.Decimal;
      inr: Prisma.Decimal;
    }>;
    let walletAfter: Prisma.Decimal;
    let heldAfter: Prisma.Decimal;

    if (input.direction === 'DEBIT') {
      const plan = await this.cash.planTakeToCapital(tx, { sellerId: input.sellerId, amount });
      cashMoved = plan.taken;
      moves = plan.moves.map((m) => ({ ...m }));
      walletAfter = walletBefore.sub(amount);
      heldAfter = heldBefore.sub(plan.taken);
    } else {
      const accountId = ctx.accountId ?? '';
      const split = await this.cash.debtSplit(tx, input.sellerId, amount);
      const capital = await this.ledger.ownerBalance(
        accountId,
        { kind: BankOwnerKind.CAPITAL },
        tx,
      );
      if (capital.lessThan(split.toSeller)) {
        throw new ConflictException({
          code: 'WALLET_TRANSFER_CAPITAL_SHORT',
          message:
            `Our own money in that account is ₹${capital.toFixed(2)}; the seller would be given ` +
            `₹${split.toSeller.toFixed(2)} of it. Choose an account that holds it, or record the money arriving first.`,
        });
      }
      cashMoved = split.toSeller;
      moves = split.toSeller.greaterThan(0)
        ? [{ accountId, currency: Currency.INR, units: split.toSeller, inr: split.toSeller }]
        : [];
      walletAfter = walletBefore.add(amount);
      heldAfter = heldBefore.add(split.toSeller);
    }

    const labels = new Map(
      (
        await tx.platformBankAccount.findMany({
          where: { id: { in: moves.map((m) => m.accountId) } },
          select: { id: true, label: true },
        })
      ).map((a) => [a.id, a.label]),
    );
    const accounts: StaffTransferAccountMove[] = [];
    for (const m of moves) {
      const sellerBefore = await this.ledger.ownerBalance(
        m.accountId,
        { kind: BankOwnerKind.SELLER, sellerId: input.sellerId },
        tx,
      );
      const capitalBefore = await this.ledger.ownerBalance(
        m.accountId,
        { kind: BankOwnerKind.CAPITAL },
        tx,
      );
      const signed = input.direction === 'DEBIT' ? m.units.neg() : m.units;
      accounts.push({
        accountId: m.accountId,
        label: labels.get(m.accountId) ?? 'Unknown account',
        currency: m.currency,
        units: m.units.toFixed(2),
        inr: m.inr.toFixed(2),
        sellerBefore: sellerBefore.toFixed(2),
        sellerAfter: sellerBefore.add(signed).toFixed(2),
        capitalBefore: capitalBefore.toFixed(2),
        capitalAfter: capitalBefore.sub(signed).toFixed(2),
      });
    }

    const withoutCash = amount.sub(cashMoved);
    return {
      sellerId: input.sellerId,
      companyName: ctx.companyName,
      direction: input.direction,
      amountInr: amount.toFixed(2),
      walletBeforeInr: walletBefore.toFixed(2),
      walletAfterInr: walletAfter.toFixed(2),
      heldBeforeInr: heldBefore.toFixed(2),
      heldAfterInr: heldAfter.toFixed(2),
      cashMovedInr: cashMoved.toFixed(2),
      withoutCashInr: withoutCash.toFixed(2),
      accounts,
      sentence: describe({
        direction: input.direction,
        company: ctx.companyName,
        amount,
        cashMoved,
        withoutCash,
        walletBefore,
        walletAfter,
        where: accounts.map((a) => a.label),
      }),
    };
  }

  /**
   * IDEM-1: the same key already wrote a transfer. Answered only when the
   * material fields match — the seller, the direction, the amount, and
   * (for a credit that moved cash) the account; anything else is refused
   * rather than answered with somebody else's transfer. The reason is prose
   * and may be retyped on a retry.
   */
  private async replay(
    input: StaffTransferInput,
    amount: Prisma.Decimal,
  ): Promise<StaffTransferResult | null> {
    const key = input.idempotencyKey;
    if (key === undefined) return null;
    const prior = await this.prisma.client.sellerWalletEntry.findUnique({
      where: { idempotencyKey: key },
      select: {
        id: true,
        sellerId: true,
        direction: true,
        amount: true,
        runningBalanceAfter: true,
      },
    });
    if (prior === null) return null;
    const direction =
      input.direction === 'DEBIT'
        ? WalletEntryDirection.STAFF_DEBIT
        : WalletEntryDirection.STAFF_CREDIT;
    if (
      prior.sellerId !== input.sellerId ||
      prior.direction !== direction ||
      !prior.amount.equals(amount)
    ) {
      throw idempotencyKeyReused('wallet transfer');
    }
    if (input.direction === 'CREDIT') {
      const pair = await this.prisma.client.bankEntry.findFirst({
        where: { reference: prior.id, ownerKind: BankOwnerKind.SELLER },
        select: { accountId: true },
      });
      if (pair !== null && pair.accountId !== input.bankAccountId) {
        throw idempotencyKeyReused('wallet transfer');
      }
    }
    return {
      walletEntryId: prior.id,
      replayed: true,
      walletAfterInr: prior.runningBalanceAfter.toFixed(2),
      preview: null,
    };
  }
}

const INR_FORMAT = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `₹1,234.50`, or `−₹388.60` for a negative figure. */
export function rupees(v: Prisma.Decimal): string {
  const s = `₹${INR_FORMAT.format(Number(v.abs().toFixed(2)))}`;
  return v.lessThan(0) ? `−${s}` : s;
}

function describe(p: {
  direction: StaffTransferDirection;
  company: string;
  amount: Prisma.Decimal;
  cashMoved: Prisma.Decimal;
  withoutCash: Prisma.Decimal;
  walletBefore: Prisma.Decimal;
  walletAfter: Prisma.Decimal;
  where: readonly string[];
}): string {
  const wallet = `their wallet goes from ${rupees(p.walletBefore)} to ${rupees(p.walletAfter)}`;
  const places = p.where.length === 0 ? 'with us' : `at ${p.where.join(', ')}`;
  if (p.direction === 'DEBIT') {
    const parts: string[] = [];
    if (p.cashMoved.greaterThan(0)) {
      parts.push(`${rupees(p.cashMoved)} of ${p.company}'s money ${places} becomes Skydrop's`);
    } else {
      parts.push(`${p.company} holds no money with us, so no cash moves`);
    }
    let s = `${parts.join('')}; ${wallet}`;
    if (p.walletAfter.lessThan(0)) {
      s += ` — they will owe us ${rupees(p.walletAfter.neg())}`;
    }
    return `${s}.`;
  }
  const clauses: string[] = [`Skydrop gives ${p.company} ${rupees(p.amount)}: ${wallet}.`];
  if (p.withoutCash.greaterThan(0)) {
    clauses.push(
      `${rupees(p.withoutCash)} clears what they owed us, so no cash moves for that part.`,
    );
  }
  if (p.cashMoved.greaterThan(0)) {
    clauses.push(`${rupees(p.cashMoved)} of our money ${places} becomes theirs.`);
  }
  return clauses.join(' ');
}
