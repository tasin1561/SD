import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BankEntryType, BankOwnerKind } from '@skydrop/db';

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { BankLedgerService } from '../services/bank-ledger.service';
import { BankTransferService } from '../services/bank-transfer.service';
import { TreasuryReadService } from '../services/treasury-read.service';
import {
  CreateExpenseCategoryDto,
  CreateInvestmentDto,
  OwnerMoneyDto,
  ReclassifySellerCashDto,
  ReconcileAccountDto,
  RecordEntryDto,
  RecordInvestmentReturnDto,
  RecordShipmentCostDto,
  RecordTransferDto,
  UpdateExpenseCategoryDto,
} from '../dto/treasury.dto';
import { ExpenseCategoryService } from '../services/expense-category.service';
import { InvestmentService } from '../services/investment.service';
import { LiabilitiesService } from '../services/liabilities.service';
import { ShipmentCostService } from '../services/shipment-cost.service';
import { ManualExpenseService } from '../services/manual-expense.service';
import { PnlService } from '../services/pnl.service';

/**
 * The treasury — our own money.
 *
 * READ and WRITE are gated separately. Seeing what we hold is an
 * ordinary finance question; recording a movement changes the books, and
 * an incorrect entry is not obviously wrong to anyone reading later.
 *
 * Nothing here moves money at a bank. It RECORDS money that moved, which
 * is why every write takes the date it happened rather than assuming
 * now: a statement line from Tuesday belongs on Tuesday.
 */
@ApiTags('admin-treasury')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.treasury.view')
@Controller('admin/treasury')
export class AdminTreasuryController {
  constructor(
    private readonly read: TreasuryReadService,
    private readonly ledger: BankLedgerService,
    private readonly transfers: BankTransferService,
    private readonly pnl: PnlService,
    private readonly categories: ExpenseCategoryService,
    private readonly investments: InvestmentService,
    private readonly liabilities: LiabilitiesService,
    private readonly shipmentCosts: ShipmentCostService,
    private readonly expenses: ManualExpenseService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Every account with its balance, split into what is ours and what is held for sellers, plus whether client money is covered.',
  })
  overview(): ReturnType<TreasuryReadService['overview']> {
    return this.read.overview();
  }

  @Get('pnl')
  @ApiOperation({
    summary:
      'Where the money is made — the four sources kept apart, each stating how much of its cost side is measured.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'ISO instant, INCLUSIVE start of the window; defaults to 30 days before `to`',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description:
      'ISO instant, EXCLUSIVE end: the window is half-open [from, to). To include a whole last day, pass the NEXT midnight. Defaults to now.',
  })
  profitAndLoss(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): ReturnType<PnlService['report']> {
    const w = pnlWindow(from, to);
    return this.pnl.report(w.from, w.to);
  }

  @Get('pnl/lines/:key/items')
  @ApiOperation({
    summary:
      'EVERY row behind one P&L line, so the total can be ticked off by hand. Capped, and the cap is reported rather than silently applied.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'As for the report: INCLUSIVE start' })
  @ApiQuery({ name: 'to', required: false, description: 'As for the report: EXCLUSIVE end' })
  @ApiQuery({ name: 'limit', required: false, description: 'Rows to return, 1–1000 (500)' })
  pnlLineItems(
    @Param('key') key: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ): ReturnType<PnlService['lineItems']> {
    // Validated exactly as the report is: the rows must cover the window
    // the total above them covers, and `new Date('x')` is an Invalid Date
    // every comparison is false against — it answered with no rows, which
    // reads as "nothing behind this line" rather than "bad request".
    const w = pnlWindow(from, to);
    let take: number | undefined;
    if (limit !== undefined && limit !== '') {
      take = Number(limit);
      if (!Number.isInteger(take) || take < 1) {
        throw new BadRequestException({
          code: 'INVALID_LIMIT',
          message: `"${limit}" is not a whole number of rows`,
        });
      }
    }
    return this.pnl.lineItems(key, w.from, w.to, take);
  }

  @Get('liabilities')
  @ApiOperation({
    summary:
      'What we owe and what is owed to us, right now. Kept apart from the P&L: profit is about a window, this is about a moment.',
  })
  liabilitiesReport(): ReturnType<LiabilitiesService['report']> {
    return this.liabilities.report();
  }

  @Post('shipments/:shipmentId/cost')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record what a parcel actually cost, from a courier invoice. Forward and return are separate figures — the delivery deduction is refunded on a return.',
  })
  recordShipmentCost(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Body() body: RecordShipmentCostDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<ShipmentCostService['record']> {
    return this.shipmentCosts.record(staff.id, shipmentId, body);
  }

  @Get('entries')
  @ApiOperation({ summary: 'The bank ledger, newest first' })
  entries(
    @Query('accountId') accountId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('expenseCategoryId') expenseCategoryId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): ReturnType<TreasuryReadService['entries']> {
    // Validated against the enum rather than passed through: an unknown
    // type would silently return the WHOLE ledger to a page asking for
    // one slice of it, which reads as a bug in the numbers.
    const parsedType =
      type !== undefined && (Object.values(BankEntryType) as string[]).includes(type)
        ? (type as BankEntryType)
        : undefined;
    if (type !== undefined && parsedType === undefined) {
      throw new BadRequestException({
        code: 'UNKNOWN_ENTRY_TYPE',
        message: `No such bank entry type: ${type}`,
      });
    }
    return this.read.entries({
      ...(accountId === undefined ? {} : { accountId }),
      ...(sellerId === undefined ? {} : { sellerId }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(parsedType === undefined ? {} : { type: parsedType }),
      ...(expenseCategoryId === undefined ? {} : { expenseCategoryId }),
      ...(from === undefined ? {} : { from: new Date(from) }),
      ...(to === undefined ? {} : { to: new Date(to) }),
    });
  }

  @Get('sellers/:sellerId/holdings')
  @ApiOperation({
    summary:
      "Where one seller's money is sitting, per account — the question a payout asks before it can be paid.",
  })
  holdings(
    @Param('sellerId', new ParseUUIDPipe({ version: '7' })) sellerId: string,
  ): ReturnType<TreasuryReadService['holdingsForSeller']> {
    return this.read.holdingsForSeller(sellerId);
  }

  @Post('transfers')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary:
      'Record a transfer between our accounts. Both amounts are given: across a currency the rate moves hour to hour, so a stored rate would disagree with the statement. When a seller was quoted a rate, they are credited at THAT rate and the difference is ours to keep or to cover.',
  })
  transfer(
    @Body() body: RecordTransferDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<BankTransferService['transfer']> {
    return this.transfers.transfer({
      fromAccountId: body.fromAccountId,
      toAccountId: body.toAccountId,
      amountOut: body.amountOut,
      amountIn: body.amountIn,
      ...(body.sellerId === undefined ? {} : { sellerId: body.sellerId }),
      ...(body.quotedRate === undefined ? {} : { quotedRate: body.quotedRate }),
      movedAt: new Date(body.movedAt),
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      ...(body.note === undefined ? {} : { note: body.note }),
      staffId: staff.id,
    });
  }

  @Post('entries')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary:
      'Record an EXPENSE — our money (CAPITAL), leaving (negative), with a category. Every other movement is refused (TREASURY_ENTRY_NOT_ALLOWED) with the flow it belongs to.',
  })
  async record(
    @Body() body: RecordEntryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ id: string }> {
    return this.expenses.record(staff.id, body);
  }

  @Post('accounts/:accountId/reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary:
      'Correct a balance against the real statement. Posts the DIFFERENCE as an entry rather than overwriting — a discrepancy that disappears is one nobody investigates.',
  })
  reconcile(
    @Param('accountId', new ParseUUIDPipe({ version: '7' })) accountId: string,
    @Body() body: ReconcileAccountDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<BankLedgerService['reconcile']> {
    return this.ledger.reconcile({
      accountId,
      owner: {
        kind: body.ownerKind,
        ...(body.sellerId === undefined ? {} : { sellerId: body.sellerId }),
      },
      statedBalance: body.statedBalance,
      reason: body.reason,
      staffId: staff.id,
    });
  }

  @Post('accounts/:accountId/owner-money')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary:
      'Record money the owner put into the business, or took out of it. Equity — never counted as income or as an expense.',
  })
  ownerMoney(
    @Param('accountId', new ParseUUIDPipe({ version: '7' })) accountId: string,
    @Body() body: OwnerMoneyDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<BankLedgerService['recordOwnerMoney']> {
    return this.ledger.recordOwnerMoney({
      accountId,
      direction: body.direction,
      amount: body.amount,
      occurredAt: new Date(body.occurredAt),
      reason: body.reason,
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      staffId: staff.id,
    });
  }

  @Post('accounts/:accountId/reclassify-seller-cash')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary:
      "Correct whose the cash in one account is — a seller's or ours — as a zero-sum pair. The account total never moves.",
  })
  reclassifySellerCash(
    @Param('accountId', new ParseUUIDPipe({ version: '7' })) accountId: string,
    @Body() body: ReclassifySellerCashDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<BankLedgerService['reclassifySellerCash']> {
    return this.ledger.reclassifySellerCash({
      accountId,
      sellerId: body.sellerId,
      direction: body.direction,
      amount: body.amount,
      reason: body.reason,
      staffId: staff.id,
    });
  }

  // ── Expense categories ───────────────────────────────────────────
  //
  // Operator-defined rather than a fixed enum: what a business spends on
  // is its own shape, and a hardcoded list sends everything real into
  // OTHER within a month.

  @Get('expense-categories')
  @ApiOperation({ summary: 'What we spend money on' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listCategories(
    @Query('includeInactive') includeInactive?: string,
  ): ReturnType<ExpenseCategoryService['list']> {
    return this.categories.list(includeInactive === 'true');
  }

  @Post('expense-categories')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a category' })
  createCategory(
    @Body() body: CreateExpenseCategoryDto,
  ): ReturnType<ExpenseCategoryService['create']> {
    return this.categories.create(body);
  }

  @Patch('expense-categories/:categoryId')
  @RequirePermissions('money.treasury.manage')
  @ApiOperation({
    summary: 'Rename or deactivate. The CODE is immutable — past entries are read back through it.',
  })
  updateCategory(
    @Param('categoryId', new ParseUUIDPipe({ version: '7' })) categoryId: string,
    @Body() body: UpdateExpenseCategoryDto,
  ): ReturnType<ExpenseCategoryService['update']> {
    return this.categories.update(categoryId, body);
  }

  // ── Investments ──────────────────────────────────────────────────

  @Get('investments')
  @ApiOperation({ summary: 'Money placed somewhere it can earn' })
  @ApiQuery({ name: 'includeClosed', required: false, type: Boolean })
  listInvestments(
    @Query('includeClosed') includeClosed?: string,
  ): ReturnType<InvestmentService['list']> {
    return this.investments.list(includeClosed === 'true');
  }

  @Post('investments')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Place capital. Leaves the bank without being spent, so coverage still reads correctly.',
  })
  placeInvestment(
    @Body() body: CreateInvestmentDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<InvestmentService['place']> {
    return this.investments.place(staff.id, body);
  }

  @Post('investments/:investmentId/return')
  @RequirePermissions('money.treasury.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record money coming back. Partial returns accumulate.' })
  recordInvestmentReturn(
    @Param('investmentId', new ParseUUIDPipe({ version: '7' })) investmentId: string,
    @Body() body: RecordInvestmentReturnDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<InvestmentService['recordReturn']> {
    return this.investments.recordReturn(staff.id, investmentId, body);
  }
}

/**
 * The P&L window `[from, to)` from two query strings — the ONE parser the
 * report and its drill-down share, so they cannot come to accept
 * different windows.
 *
 * A bad date silently becoming "now" (or an Invalid Date, which every
 * comparison is false against) would report the wrong window as
 * confidently as the right one, so it is refused, as is a window that
 * starts after it ends.
 */
export function pnlWindow(
  from: string | undefined,
  to: string | undefined,
): { from: Date; to: Date } {
  const parse = (v: string | undefined, fallback: Date): Date => {
    if (v === undefined || v === '') return fallback;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_DATE',
        message: `"${v}" is not a date`,
      });
    }
    return d;
  };
  const toDate = parse(to, new Date());
  const fromDate = parse(from, new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000));
  if (fromDate > toDate) {
    throw new BadRequestException({
      code: 'INVALID_RANGE',
      message: 'The window starts after it ends',
    });
  }
  return { from: fromDate, to: toDate };
}

export { BankEntryType, BankOwnerKind };
