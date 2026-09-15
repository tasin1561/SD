import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, Prisma, SellerStoreKind, StoreExpenseCategory } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { isUniqueViolation } from '../../treasury/services/bank-ledger.service';
import { istDayOf, monthOf } from '../../pnl-carry-forward/services/pnl-month';
import { EXPENSE_CATEGORY_LABELS, expenseInstant } from './store-pnl-lines';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_REASON = 5;
const ZERO = new Prisma.Decimal(0);

export interface StoreExpenseView {
  readonly id: string;
  readonly category: StoreExpenseCategory;
  readonly categoryLabel: string;
  readonly amountInr: string;
  /** The Indian calendar day, `YYYY-MM-DD`. */
  readonly expenseDate: string;
  readonly description: string;
  readonly reference: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly deleteReason: string | null;
}

export interface StoreExpenseList {
  readonly items: readonly StoreExpenseView[];
  /** Live (not deleted) expenses only. */
  readonly totalInr: string;
  readonly byCategory: ReadonlyArray<{
    readonly category: StoreExpenseCategory;
    readonly label: string;
    readonly amountInr: string;
  }>;
}

export interface RecordStoreExpenseInput {
  readonly category: StoreExpenseCategory;
  readonly amountInr: string;
  readonly expenseDate: string;
  readonly description: string;
  readonly reference?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

type Row = {
  id: string;
  storeId: string;
  category: StoreExpenseCategory;
  amountInr: Prisma.Decimal;
  expenseDate: Date;
  description: string;
  reference: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  deleteReason: string | null;
};

const SELECT = {
  id: true,
  storeId: true,
  category: true,
  amountInr: true,
  expenseDate: true,
  description: true,
  reference: true,
  createdAt: true,
  deletedAt: true,
  deleteReason: true,
} as const;

function toView(r: Row): StoreExpenseView {
  return {
    id: r.id,
    category: r.category,
    categoryLabel: EXPENSE_CATEGORY_LABELS[r.category],
    amountInr: r.amountInr.toFixed(2),
    expenseDate: r.expenseDate.toISOString().slice(0, 10),
    description: r.description,
    reference: r.reference,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deleteReason: r.deleteReason,
  };
}

/**
 * A reseller store's OWN expense book (RS-8).
 *
 * The store's bookkeeping, and nothing else: no wallet entry, no bank
 * entry (decision 7 — our bank knows only the seller), nothing the seller
 * can read (a seller sees a store's scorecard and balance, never its
 * expenses or P&L). Every query is scoped by the TOKEN's store id.
 *
 * Never edited: a mistake is SOFT-deleted with a reason the store can
 * read later, so a closed month's carry-forward can say "removed after
 * the month closed" rather than a figure silently changing.
 */
@Injectable()
export class StoreExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(
    storeId: string,
    window: { from: Date; to: Date },
    includeDeleted = true,
  ): Promise<StoreExpenseList> {
    const rows = await this.prisma.client.storeExpense.findMany({
      where: { storeId, ...(includeDeleted ? {} : { deletedAt: null }) },
      select: SELECT,
      orderBy: [{ expenseDate: 'desc' }, { id: 'desc' }],
    });
    const inWindow = rows.filter((r) => {
      const at = expenseInstant(r.expenseDate);
      return at >= window.from && at < window.to;
    });
    const live = inWindow.filter((r) => r.deletedAt === null);
    const byCategory = new Map<StoreExpenseCategory, Prisma.Decimal>();
    for (const r of live) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? ZERO).add(r.amountInr));
    }
    return {
      items: inWindow.map(toView),
      totalInr: live.reduce((t, r) => t.add(r.amountInr), ZERO).toFixed(2),
      byCategory: [...byCategory].map(([category, amount]) => ({
        category,
        label: EXPENSE_CATEGORY_LABELS[category],
        amountInr: amount.toFixed(2),
      })),
    };
  }

  async record(
    user: AuthenticatedStoreUser,
    input: RecordStoreExpenseInput,
    now: Date = new Date(),
  ): Promise<StoreExpenseView & { readonly replayed: boolean }> {
    if (!AMOUNT.test(input.amountInr) || new Prisma.Decimal(input.amountInr).lte(0)) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Give the amount in rupees, more than zero, with at most two decimals.',
      });
    }
    const description = input.description.trim();
    if (description.length < 3) {
      throw new BadRequestException({
        code: 'DESCRIPTION_REQUIRED',
        message: 'Say what it was for, in at least 3 characters.',
      });
    }
    const m = DATE.exec(input.expenseDate);
    const date = m === null ? null : new Date(`${input.expenseDate}T00:00:00.000Z`);
    if (
      date === null ||
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.expenseDate
    ) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: 'Give the date the money was spent as YYYY-MM-DD.',
      });
    }
    if (input.expenseDate > istDayOf(now)) {
      throw new BadRequestException({
        code: 'EXPENSE_DATE_IN_FUTURE',
        message: 'That date has not happened yet.',
      });
    }
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: user.storeId, kind: SellerStoreKind.RESELLER },
      select: { createdAt: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    // The P&L months begin with the store's first month; an expense dated
    // before it would sit in no month at all.
    if (input.expenseDate.slice(0, 7) < monthOf(store.createdAt)) {
      throw new BadRequestException({
        code: 'EXPENSE_BEFORE_STORE',
        message: `The store’s books start in ${monthOf(store.createdAt)}; an expense cannot be dated earlier.`,
      });
    }
    const amount = new Prisma.Decimal(input.amountInr);
    const reference = input.reference?.trim() || null;

    const matches = (r: Row): boolean =>
      r.storeId === user.storeId &&
      r.category === input.category &&
      r.amountInr.eq(amount) &&
      r.expenseDate.toISOString().slice(0, 10) === input.expenseDate &&
      r.description === description &&
      r.reference === reference;

    const replay = async (): Promise<(StoreExpenseView & { replayed: boolean }) | null> => {
      if (input.idempotencyKey === undefined) return null;
      const prior = await this.prisma.client.storeExpense.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: SELECT,
      });
      if (prior === null) return null;
      if (!matches(prior)) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'That form was already used for a different expense. Reload and try again.',
        });
      }
      return { ...toView(prior), replayed: true };
    };

    const earlier = await replay();
    if (earlier !== null) return earlier;

    let row: Row;
    try {
      row = await this.prisma.client.storeExpense.create({
        data: {
          storeId: user.storeId,
          sellerId: user.sellerId,
          category: input.category,
          amountInr: amount,
          expenseDate: date,
          description,
          reference,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByStoreUserId: user.id,
        },
        select: SELECT,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await replay();
        if (winner !== null) return winner;
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.expense.recorded',
      entityType: 'store_expense',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: user.storeId,
        category: row.category,
        amountInr: row.amountInr.toFixed(2),
        expenseDate: input.expenseDate,
      },
    });
    return { ...toView(row), replayed: false };
  }

  async remove(
    user: AuthenticatedStoreUser,
    expenseId: string,
    reason: string,
  ): Promise<StoreExpenseView> {
    const why = reason.trim();
    if (why.length < MIN_REASON) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: `Say why, in at least ${MIN_REASON} characters — it stays on the record.`,
      });
    }
    // Guarded on "still live", scoped by the TOKEN's store in the same
    // WHERE: a second click, or somebody else's id, moves nothing.
    const moved = await this.prisma.client.storeExpense.updateMany({
      where: { id: expenseId, storeId: user.storeId, deletedAt: null },
      data: { deletedAt: new Date(), deletedByStoreUserId: user.id, deleteReason: why },
    });
    if (moved.count === 0) {
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: 'No such expense, or it was already removed.',
      });
    }
    const row = await this.prisma.client.storeExpense.findFirst({
      where: { id: expenseId, storeId: user.storeId },
      select: SELECT,
    });
    if (row === null) {
      throw new NotFoundException({ code: 'EXPENSE_NOT_FOUND', message: 'No such expense.' });
    }
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.sellerId,
      action: 'store.expense.removed',
      entityType: 'store_expense',
      entityId: row.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: user.storeId,
        amountInr: row.amountInr.toFixed(2),
        expenseDate: row.expenseDate.toISOString().slice(0, 10),
        reason: why,
      },
    });
    return toView(row);
  }
}
