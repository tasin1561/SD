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
import { CallAssignmentService, type PulledAssignment } from '../services/call-assignment.service';
import {
  CallAttemptService,
  type RecordAttemptInput,
  type RecordAttemptResult,
} from '../services/call-attempt.service';
import { RecordCallAttemptDto } from '../dto/record-call-attempt.dto';
import { CallHistoryQueryDto } from '../dto/call-history-query.dto';

/**
 * Agent call workflow (pull model — locked decision #4). Staff JWT only;
 * broad CALL_AGENT-only role scoping is the deferred RBAC concern (same
 * Phase-1A posture as the other staff controllers). The
 * assignment-ownership check IS enforced now, in the services.
 */
@ApiTags('agent-calls')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('agent/calls')
export class AgentCallController {
  constructor(
    private readonly assignment: CallAssignmentService,
    private readonly attempts: CallAttemptService,
  ) {}

  @Post('next')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull the next FIFO call (SKIP LOCKED). 200 with assignment, or assignment:null when QUEUE_EMPTY; 409 AGENT_AT_CAPACITY at the cap',
  })
  async next(
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ assignment: PulledAssignment | null }> {
    const assignment = await this.assignment.pullNext(staff.id, ctx);
    return { assignment };
  }

  @Post(':assignmentId/record-attempt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a call outcome (CC-1/CC-3/CC-4). Drives the post-commit M5/M6 saga + re-queue',
  })
  recordAttempt(
    @Param('assignmentId', new ParseUUIDPipe({ version: '7' }))
    assignmentId: string,
    @Body() body: RecordCallAttemptDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RecordAttemptResult> {
    const input: RecordAttemptInput = {
      assignmentId,
      agentId: staff.id,
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
    };
    return this.attempts.recordAttempt(input);
  }

  @Get('current')
  @ApiOperation({ summary: "The calling agent's in-flight ASSIGNED call(s)" })
  async current(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ assignments: PulledAssignment[] }> {
    return { assignments: await this.assignment.listCurrent(staff.id) };
  }

  @Get('history')
  @ApiOperation({ summary: "The calling agent's own attempt history (newest first)" })
  history(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Query() query: CallHistoryQueryDto,
  ): ReturnType<CallAttemptService['listHistory']> {
    return this.attempts.listHistory(staff.id, query.page ?? 1, query.pageSize ?? 20);
  }

  @Post(':assignmentId/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abandon an assignment without an attempt — entry returns to PENDING for FIFO re-pick',
  })
  release(
    @Param('assignmentId', new ParseUUIDPipe({ version: '7' }))
    assignmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ released: boolean }> {
    return this.assignment.release(assignmentId, staff.id, ctx);
  }
}
