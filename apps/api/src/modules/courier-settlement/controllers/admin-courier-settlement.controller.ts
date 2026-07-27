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
import { StaffRole } from '@skydrop/db';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
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
@Controller('admin/courier-settlements')
export class AdminCourierSettlementController {
  constructor(private readonly svc: CourierSettlementService) {}

  @Post()
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
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
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
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query('courierAccountId') courierAccountId?: string,
    @Query('limit') limit?: string,
  ): Promise<readonly SettlementView[]> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
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
  reconciliation(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() query: ReconciliationQueryDto,
  ): Promise<ReconciliationReport> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.reconciliation(
      query.overdueAfterDays === undefined ? {} : { overdueAfterDays: query.overdueAfterDays },
    );
  }

  @Get(':settlementId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One payout with its per-order allocation' })
  getById(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('settlementId', new ParseUUIDPipe({ version: '7' }))
    settlementId: string,
  ): Promise<SettlementView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.getById(settlementId);
  }
}
