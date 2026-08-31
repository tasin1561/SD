import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WithdrawalRequestStatus } from '@skydrop/db';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  MarkWithdrawalRequestPaidDto,
  ApproveWithdrawalRequestDto,
  RejectWithdrawalRequestDto,
} from '../dto/withdrawal-request.dto';
import {
  WithdrawalRequestService,
  type WithdrawalRequestView,
} from '../services/withdrawal-request.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Admin surface for resolving withdrawal requests (R2). RBAC is
 * StaffJwtGuard-only for now, matching the sibling admin-remittance
 * controller. `markPaid` LINKS an already-created Remittance — it
 * never creates one; the admin uses the existing
 * `POST /admin/remittances` flow first, then links it here.
 */
@ApiTags('admin-withdrawal-requests')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('money.view')
@Controller('admin/withdrawal-requests')
export class AdminWithdrawalRequestController {
  constructor(private readonly svc: WithdrawalRequestService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List/filter withdrawal requests' })
  list(
    @Query('sellerId') sellerId?: string,
    @Query('status') status?: WithdrawalRequestStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{
    items: readonly WithdrawalRequestView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.svc.listForAdmin({
      ...(sellerId === undefined ? {} : { sellerId }),
      ...(status === undefined ? {} : { status }),
      ...(page === undefined ? {} : { page: Number(page) }),
      ...(pageSize === undefined ? {} : { pageSize: Number(pageSize) }),
    });
  }

  @Patch(':requestId/approve')
  @RequirePermissions('money.withdrawals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Say yes before the money moves. Moves NO money and is not the last word — the request ' +
      'stays unpaid, still counts against the SLA, and can still be rejected. Optional: ' +
      'marking a PENDING request paid directly is still allowed. Refuses ' +
      'WITHDRAWAL_BALANCE_NO_LONGER_COVERS when the balance has fallen since the request.',
  })
  approve(
    @Param('requestId') requestId: string,
    @Body() body: ApproveWithdrawalRequestDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<WithdrawalRequestView> {
    return this.svc.approve(requestId, staff.id, body.note);
  }

  @Patch(':requestId/paid')
  @RequirePermissions('money.withdrawals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Link an existing Remittance to this request and mark it PAID (rejects WITHDRAWAL_REQUEST_ALREADY_RESOLVED / REMITTANCE_NOT_FOUND / REMITTANCE_SELLER_MISMATCH)',
  })
  markPaid(
    @Param('requestId') requestId: string,
    @Body() body: MarkWithdrawalRequestPaidDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<WithdrawalRequestView> {
    return this.svc.markPaid(requestId, staff.id, body.linkedRemittanceId);
  }

  @Patch(':requestId/reject')
  @RequirePermissions('money.withdrawals.review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending withdrawal request' })
  reject(
    @Param('requestId') requestId: string,
    @Body() body: RejectWithdrawalRequestDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<WithdrawalRequestView> {
    return this.svc.reject(requestId, staff.id, body.reason);
  }
}
