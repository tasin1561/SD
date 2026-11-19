import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BulkDecideDto } from '../../../common/bulk/bulk-action.dto';
import { BulkRunnerService, type BulkResult } from '../../../common/bulk/bulk-runner.service';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { DeliveryActionDecisionService } from '../services/delivery-action-decision.service';

@ApiTags('admin-delivery-actions')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.ops.write')
@Controller('admin/bulk/delivery-actions')
export class AdminBulkDeliveryActionController {
  constructor(
    private readonly svc: DeliveryActionDecisionService,
    private readonly bulk: BulkRunnerService,
  ) {}

  @Post('approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve and carry out up to 200 client requests (re-attempt / RTO reach Delhivery; recall enqueues our agents) — each as its own Approve would. Results keyed by REQUEST id.',
  })
  approve(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: BulkDecideDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkResult> {
    return this.bulk.run(
      {
        actor: { type: 'STAFF', id: staff.id },
        action: 'admin.delivery-action.approve',
        idempotencyKey: body.idempotencyKey,
        ids: body.requestIds,
        params: { note: body.note ?? null },
      },
      async (requestId) => {
        await this.svc.approve(staff.id, requestId, body.note ?? null, ctx);
      },
    );
  }

  @Post('reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline up to 200 client requests with one reason (shown to the client).',
  })
  reject(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: BulkDecideDto,
  ): Promise<BulkResult> {
    // Same rule as the single reject: a refusal a client cannot understand
    // comes straight back.
    const note = body.note?.trim() ?? '';
    if (note.length < 5) {
      throw new BadRequestException({
        code: 'DELIVERY_ACTION_REASON_REQUIRED',
        message: 'Say why. The client sees this, and an unexplained no comes straight back.',
      });
    }
    return this.bulk.run(
      {
        actor: { type: 'STAFF', id: staff.id },
        action: 'admin.delivery-action.reject',
        idempotencyKey: body.idempotencyKey,
        ids: body.requestIds,
        params: { note },
      },
      async (requestId) => {
        await this.svc.reject(staff.id, requestId, note);
      },
    );
  }
}
