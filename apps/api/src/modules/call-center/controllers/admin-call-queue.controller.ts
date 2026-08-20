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
import type { RecordAttemptResult } from '../services/call-attempt.service';
import {
  AdminCallQueueService,
  type CallQueueAdminRow,
  type CallQueueStats,
} from '../services/admin-call-queue.service';
import {
  BulkDequeueDto,
  ListCallQueueQueryDto,
  ReassignDto,
  RescheduleQueueEntryDto,
} from '../dto/admin-call-queue.dto';
import { RecordCallAttemptDto } from '../dto/record-call-attempt.dto';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Admin queue ops (decision 11). Staff JWT only — broad admin-only role
 * scoping is the deferred RBAC concern (same Phase-1A posture as the
 * other admin controllers). force-outcome routes through the SAME
 * CallAttemptService (CC-2/CC-3) with forceByAdmin.
 */
@ApiTags('admin-call-queue')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('callcenter.queue.view')
@Controller('admin/call-queue')
export class AdminCallQueueController {
  constructor(private readonly svc: AdminCallQueueService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated queue view (status / seller / agent filters)' })
  list(@Query() query: ListCallQueueQueryDto): Promise<{
    items: CallQueueAdminRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.svc.listQueue({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.agentId ? { agentId: query.agentId } : {}),
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Per-queue + per-agent SUMMARY stats (decision 12)' })
  stats(): Promise<CallQueueStats> {
    return this.svc.stats();
  }

  @Post(':entryId/reassign')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard-reassign an OPEN entry to a specific agent' })
  reassign(
    @Param('entryId', new ParseUUIDPipe({ version: '7' })) entryId: string,
    @Body() body: ReassignDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ id: string; assignedAgentId: string; status: string }> {
    return this.svc.reassign(entryId, body.toAgentId, staff.id, ctx);
  }

  @Post(':entryId/reschedule')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move when a queued call becomes callable — timing only, never the attempt count',
  })
  reschedule(
    @Param('entryId', new ParseUUIDPipe({ version: '7' })) entryId: string,
    @Body() body: RescheduleQueueEntryDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ id: string; availableAt: Date; status: string }> {
    return this.svc.reschedule(entryId, new Date(body.availableAt), body.reason, staff.id, ctx);
  }

  @Post(':entryId/force-outcome')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Force a call outcome on an OPEN entry (delegates to CallAttemptService, forceByAdmin)',
  })
  forceOutcome(
    @Param('entryId', new ParseUUIDPipe({ version: '7' })) entryId: string,
    @Body() body: RecordCallAttemptDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RecordAttemptResult> {
    return this.svc.forceOutcome(
      entryId,
      {
        outcome: body.outcome,
        startedAt: new Date(body.startedAt),
        ctx,
        ...(body.endedAt ? { endedAt: new Date(body.endedAt) } : {}),
        ...(body.scheduledFor ? { scheduledFor: new Date(body.scheduledFor) } : {}),
        ...(body.outcomeNotes !== undefined ? { outcomeNotes: body.outcomeNotes } : {}),
        ...(body.customerSaidName !== undefined ? { customerSaidName: body.customerSaidName } : {}),
        ...(body.customerSaidAddress !== undefined
          ? { customerSaidAddress: body.customerSaidAddress }
          : {}),
        ...(body.customerVerifiedItems !== undefined
          ? { customerVerifiedItems: body.customerVerifiedItems }
          : {}),
        ...(body.rescheduledReason !== undefined
          ? { rescheduledReason: body.rescheduledReason }
          : {}),
        ...(body.flaggedAsSuspicious !== undefined
          ? { flaggedAsSuspicious: body.flaggedAsSuspicious }
          : {}),
        ...(body.suspicionReason !== undefined ? { suspicionReason: body.suspicionReason } : {}),
      },
      staff.id,
    );
  }

  @Post('bulk-dequeue')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close every OPEN queue entry for a seller (CONFIRMED orders untouched)',
  })
  bulkDequeue(
    @Body() body: BulkDequeueDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ sellerId: string; dequeuedOrders: number }> {
    return this.svc.bulkDequeue(body.sellerId, body.reason, staff.id, ctx);
  }
}
