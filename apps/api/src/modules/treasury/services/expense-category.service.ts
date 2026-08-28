import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface ExpenseCategoryView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly hint: string | null;
  readonly isActive: boolean;
}

/**
 * What we spend money ON.
 *
 * Categories are created by an operator rather than shipped as a fixed
 * list: what a business spends on is its own shape, and a hardcoded
 * enum would send everything real into OTHER within a month.
 *
 * They are DEACTIVATED, never deleted. A category with entries behind it
 * is the only thing that says what those entries were for, and removing
 * it would silently rewrite last quarter's expense breakdown.
 */
@Injectable()
export class ExpenseCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(includeInactive: boolean): Promise<ExpenseCategoryView[]> {
    const rows = await this.prisma.client.expenseCategory.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, hint: true, isActive: true },
    });
    return rows;
  }

  async create(input: { code: string; name: string; hint?: string }): Promise<ExpenseCategoryView> {
    // Normalised so RENT, rent and Rent cannot become three categories
    // that each hold a third of the year's rent.
    //
    // LOWER, not upper, because that is what the seed ships. Upper-casing
    // here meant a typed "salaries" became SALARIES and sat alongside the
    // seeded `salaries` as a second category — the exact split this
    // normalisation exists to prevent, reintroduced across the seed
    // boundary. Caught by reading the category list on the page.
    const code = input.code.trim().toLowerCase().replace(/\s+/g, '_');
    const clash = await this.prisma.client.expenseCategory.findUnique({
      where: { code },
      select: { id: true, deletedAt: true },
    });
    if (clash) {
      throw new ConflictException({
        code: 'EXPENSE_CATEGORY_EXISTS',
        message: `A category with the code ${code} already exists`,
      });
    }
    return this.prisma.client.expenseCategory.create({
      data: { code, name: input.name.trim(), hint: input.hint?.trim() ?? null },
      select: { id: true, code: true, name: true, hint: true, isActive: true },
    });
  }

  async update(
    id: string,
    input: { name?: string; hint?: string; isActive?: boolean },
  ): Promise<ExpenseCategoryView> {
    const existing = await this.prisma.client.expenseCategory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'EXPENSE_CATEGORY_NOT_FOUND',
        message: 'No such category',
      });
    }
    // The CODE is deliberately immutable — past entries are read back
    // through it, and renaming it would re-label history.
    return this.prisma.client.expenseCategory.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.hint === undefined ? {} : { hint: input.hint.trim() }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      select: { id: true, code: true, name: true, hint: true, isActive: true },
    });
  }
}
