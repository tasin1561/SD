import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { ReconcileAccountDto, RecordEntryDto, RecordTransferDto } from '../dto/treasury.dto';
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
  @ApiQuery({ name: 'from', required: false, description: 'ISO date; defaults to 30 days ago' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date; defaults to now' })
  profitAndLoss(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): ReturnType<PnlService['report']> {
    // A bad date silently becoming "now" would report the wrong window
    // as confidently as the right one.
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
    return this.pnl.report(fromDate, toDate);
  }

  @Get('entries')
  @ApiOperation({ summary: 'The bank ledger, newest first' })
  entries(
    @Query('accountId') accountId?: string,
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
  ): ReturnType<TreasuryReadService['entries']> {
    return this.read.entries({
      ...(accountId === undefined ? {} : { accountId }),
      ...(sellerId === undefined ? {} : { sellerId }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
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
      'Record one movement — an expense, an opening balance, money in that no other flow covers.',
  })
  async record(
    @Body() body: RecordEntryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ id: string }> {
    return this.ledger.post({
      accountId: body.accountId,
      type: body.type,
      signedAmount: body.signedAmount,
      amountCurrency: body.amountCurrency,
      owner: {
        kind: body.ownerKind,
        ...(body.sellerId === undefined ? {} : { sellerId: body.sellerId }),
      },
      occurredAt: new Date(body.occurredAt),
      ...(body.expenseCategoryId === undefined
        ? {}
        : { expenseCategoryId: body.expenseCategoryId }),
      ...(body.investmentId === undefined ? {} : { investmentId: body.investmentId }),
      ...(body.reference === undefined ? {} : { reference: body.reference }),
      ...(body.note === undefined ? {} : { note: body.note }),
      staffId: staff.id,
    });
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
}

export { BankEntryType, BankOwnerKind };
