import {
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  RecordStoreExpenseDto,
  RemoveStoreExpenseDto,
  ReportWindowQueryDto,
} from '../dto/reseller-reports.dto';
import { reportWindow } from '../services/report-window';
import {
  StoreExpenseService,
  type StoreExpenseList,
  type StoreExpenseView,
} from '../services/store-expense.service';

/**
 * A reseller store's OWN expense book (RS-8). Scoped by the token's store;
 * no store id in any path. Never a wallet or bank movement.
 */
@ApiTags('store-expenses')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('expenses.view')
@Controller('store/expenses')
export class StoreExpenseController {
  constructor(private readonly expenses: StoreExpenseService) {}

  @Get()
  @ApiOperation({ summary: 'Expenses dated in the window, removed ones included and marked' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() q: ReportWindowQueryDto,
  ): Promise<StoreExpenseList> {
    return this.expenses.list(user.storeId, reportWindow(q.from, q.to, 90));
  }

  @Post()
  @RequireStorePermissions('expenses.manage')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record an expense (idempotent on the form’s key)' })
  record(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: RecordStoreExpenseDto,
  ): Promise<StoreExpenseView & { replayed: boolean }> {
    return this.expenses.record(user, body);
  }

  @Post(':expenseId/remove')
  @RequireStorePermissions('expenses.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a mistaken expense, with a reason that stays on the record' })
  remove(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Body() body: RemoveStoreExpenseDto,
  ): Promise<StoreExpenseView> {
    return this.expenses.remove(user, expenseId, body.reason);
  }
}
