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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AssistantRollbackDto } from '../dto/assistant.dto';
import { AssistantRecommendationWorker } from '../queue/assistant-recommendation.worker';
import { AssistantGithubIssueService } from '../services/assistant-github-issue.service';
import {
  AssistantRecommendationService,
  isRecommendationFilter,
  type RecommendationFilter,
} from '../services/assistant-recommendation.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The recommendations screen's API (Super Admin: `assistant.admin`, enforced
 * here on every handler; the console hides the page by the same key but that
 * is cosmetic). Nothing on this controller can be reached by the monitor or
 * by the assistant itself: every route that changes anything is a person's
 * authenticated request, and the ones that change what the assistant says
 * (approve, rollback) are audited.
 */
@ApiTags('admin-assistant-recommendations')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('assistant.admin')
@Controller('admin/assistant-recommendations')
export class AdminAssistantRecommendationsController {
  constructor(
    private readonly recs: AssistantRecommendationService,
    private readonly worker: AssistantRecommendationWorker,
    private readonly github: AssistantGithubIssueService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The queue: new / approved / rejected / live / rolled back' })
  list(@Query('status') status?: unknown) {
    // A repeated query parameter arrives as an array: only a known single value is used.
    if (status !== undefined && status !== '' && !isRecommendationFilter(status)) {
      throw new BadRequestException({ code: 'BAD_STATUS', message: 'Unknown status filter.' });
    }
    const filter: RecommendationFilter | null = isRecommendationFilter(status) ? status : null;
    return this.recs.list(filter);
  }

  @Get('versions')
  @ApiOperation({ summary: 'Knowledge version history and which one is live' })
  versions() {
    return this.recs.history();
  }

  @Post('draft')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ask Haiku to draft recommendations from the latest themes (queued)' })
  async draft() {
    await this.worker.enqueueDraft();
    return { queued: true };
  }

  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Roll the live knowledge back to an earlier version (audited)' })
  rollback(@CurrentStaff() staff: AuthenticatedStaff, @Body() body: AssistantRollbackDto) {
    return this.recs.rollback(staff.id, body.versionId, body.expectedLive);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One recommendation with its evidence, draft and the latest check' })
  detail(@Param('id', uuid()) id: string) {
    return this.recs.detail(id);
  }

  @Post(':id/check')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Run the eval gate on a draft (queued; poll the recommendation)' })
  async check(@CurrentStaff() staff: AuthenticatedStaff, @Param('id', uuid()) id: string) {
    const { runId } = await this.recs.openCheck(id, staff.id);
    await this.worker.enqueueCheck(runId);
    return { runId };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve: a knowledge draft goes live only after a passing check (audited)',
  })
  approve(@CurrentStaff() staff: AuthenticatedStaff, @Param('id', uuid()) id: string) {
    return this.recs.approve(id, staff.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a recommendation (audited)' })
  reject(@CurrentStaff() staff: AuthenticatedStaff, @Param('id', uuid()) id: string) {
    return this.recs.reject(id, staff.id);
  }

  @Post(':id/github-issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a GitHub issue from a system task (only when the server has a token)',
  })
  issue(@CurrentStaff() staff: AuthenticatedStaff, @Param('id', uuid()) id: string) {
    return this.github.create(id, staff.id);
  }
}
