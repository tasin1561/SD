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

import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RecordSettlementDto, ReconciliationQueryDto } from '../dto/courier-settlement.dto';
import {
  CourierSettlementService,
  type ReconciliationReport,
  type SettlementView,
} from '../services/courier-settlement.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * R2c admin surface — the inbound half of the COD loop.
 *
 * FINANCE / SUPER_ADMIN only: these records are what the business
 * reconciles its bank against. Reads are gated the same way as writes
 * here, because the reconciliation report is a statement about company
 * cash rather than operational data.
 */
@ApiTags('admin-courier-settlements')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.view')
@Controller('admin/courier-settlements')
export class AdminCourierSettlementController {
  constructor(private readonly svc: CourierSettlementService) {}

  @Post()
  @RequirePermissions('money.settlements.record')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Record a courier payout and allocate it across the orders it covers. Idempotent on the courier's payout reference (409 SETTLEMENT_ALREADY_RECORDED).",
  })
  record(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RecordSettlementDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<SettlementView> {
    return this.svc.record(
      staff.id,
      {
        courierAccountId: body.courierAccountId,
        reference: body.reference,
        amountInr: body.amountInr,
        receivedAt: body.receivedAt,
        lines: body.lines,
        ...(body.note === undefined ? {} : { note: body.note }),
      },
      ctx,
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recorded payouts, newest first' })
  list(
    @Query('courierAccountId') courierAccountId?: string,
    @Query('limit') limit?: string,
  ): Promise<readonly SettlementView[]> {
    return this.svc.list({
      ...(courierAccountId === undefined ? {} : { courierAccountId }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }

  @Get('reconciliation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'The float report: COD owed on delivered orders no payout covers yet, how much of it is overdue, and which orders a payout under-paid. Read-only — a short-payment is a conversation with the courier, never a clawback from the seller.',
  })
  reconciliation(@Query() query: ReconciliationQueryDto): Promise<ReconciliationReport> {
    return this.svc.reconciliation(
      query.overdueAfterDays === undefined ? {} : { overdueAfterDays: query.overdueAfterDays },
    );
  }

  @Get(':settlementId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One payout with its per-order allocation' })
  getById(
    @Param('settlementId', new ParseUUIDPipe({ version: '7' }))
    settlementId: string,
  ): Promise<SettlementView> {
    return this.svc.getById(settlementId);
  }
}
