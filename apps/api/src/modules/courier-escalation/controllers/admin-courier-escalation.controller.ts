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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { DelhiverySupportAdapterService } from '../../courier-delhivery/services/delhivery-support-adapter.service';
import {
  ConfirmModeChangeDto,
  ListOutboxQueryDto,
  MarkSentDto,
  PauseChannelDto,
  RequestModeChangeDto,
} from '../dto/courier-ops.dto';
import {
  CourierChannelSettingsService,
  HUMAN_ONLY_CATEGORY_LABELS,
  type ChannelSettingsView,
} from '../services/courier-channel-settings.service';
import { CourierModeChallengeService } from '../services/courier-mode-challenge.service';
import {
  CourierOpsQueueService,
  type OpsQueueCounts,
  type OpsQueueItem,
} from '../services/courier-ops-queue.service';
import {
  CourierOutboxReconcilerService,
  type ReconcileSummary,
} from '../services/courier-outbox-reconciler.service';

/**
 * The ops console's API — the MANUAL consumer of the outbox.
 *
 * ── RBAC IS THE EXISTING ONE ─────────────────────────────────────────
 * `courier.ops.view` to look, `courier.ops.write` to act. No new
 * permission vocabulary: an operator who can already cancel a parcel or
 * fire an NDR action is the same person who pastes a comment, and
 * inventing a third permission for the same human is how permission sets
 * drift out of anyone's head.
 *
 * ── WHY THERE IS NO "MARK CONFIRMED" ENDPOINT ────────────────────────
 * Deliberate. The tick comes from a read-back and nothing else, so there
 * is no route a human could call to assert success. If one existed,
 * somebody would eventually use it to clear a stuck queue, and the queue
 * would then be clean and wrong.
 */
@ApiTags('admin-courier-escalation')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/courier-escalation')
export class AdminCourierEscalationController {
  constructor(
    private readonly queue: CourierOpsQueueService,
    private readonly settings: CourierChannelSettingsService,
    private readonly challenges: CourierModeChallengeService,
    private readonly reconciler: CourierOutboxReconcilerService,
    private readonly adapter: DelhiverySupportAdapterService,
  ) {}

  // ── the queue ───────────────────────────────────────────────────────

  @Get('outbox')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({ summary: 'The ops queue: what needs a human, oldest first.' })
  list(@Query() query: ListOutboxQueryDto): Promise<OpsQueueItem[]> {
    return this.queue.list({
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
  }

  @Get('outbox/counts')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({ summary: "Today's auto / manual / failed counts for the console header." })
  counts(): Promise<OpsQueueCounts> {
    return this.queue.counts();
  }

  @Post('outbox/:itemId/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'Take the item for ~10 minutes. The lease is what stops a human and the worker both acting on one message.',
  })
  claim(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('itemId', new ParseUUIDPipe({ version: '7' })) itemId: string,
  ): Promise<OpsQueueItem> {
    return this.queue.claim(itemId, staff.id);
  }

  @Post('outbox/:itemId/mark-sent')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'Records that it was dispatched — SENT_UNCONFIRMED, never CONFIRMED. Paste the ticket id to bind replies to this escalation.',
  })
  async markSent(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('itemId', new ParseUUIDPipe({ version: '7' })) itemId: string,
    @Body() body: MarkSentDto,
  ): Promise<{ ok: true }> {
    await this.queue.markSent({
      itemId,
      staffId: staff.id,
      externalTicketId: body.externalTicketId ?? null,
    });
    return { ok: true };
  }

  @Post('outbox/:itemId/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({ summary: 'Give the item back to the queue instead of holding a dead lease.' })
  async release(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('itemId', new ParseUUIDPipe({ version: '7' })) itemId: string,
  ): Promise<{ ok: true }> {
    await this.queue.release(itemId, staff.id);
    return { ok: true };
  }

  @Post('reconcile')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'Run the reconciler now. Reads current state from Delhivery before deciding anything about SENT_UNCONFIRMED items.',
  })
  reconcile(): Promise<ReconcileSummary> {
    return this.reconciler.reconcile();
  }

  // ── the mode switch ─────────────────────────────────────────────────

  @Get('channel')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({
    summary: 'Write mode, auto list, pause state, and what the channel can actually do.',
  })
  async channel(): Promise<{
    readonly settings: ChannelSettingsView;
    readonly capabilities: ReturnType<DelhiverySupportAdapterService['capabilities']>;
    readonly lockedCategoryLabels: readonly string[];
    readonly counts: OpsQueueCounts;
  }> {
    const [settings, counts] = await Promise.all([this.settings.get(), this.queue.counts()]);
    return {
      settings,
      // Surfaced so the console can explain WHY nothing is automated:
      // with every write capability false, AUTO would change nothing.
      capabilities: this.adapter.capabilities(),
      lockedCategoryLabels: HUMAN_ONLY_CATEGORY_LABELS,
      counts,
    };
  }

  @Post('channel/mode/request')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary: 'Step 1 of 2 — mails a six-digit code to the requesting staff member.',
  })
  requestModeChange(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RequestModeChangeDto,
  ): Promise<{ challengeId: string; expiresAt: Date }> {
    return this.challenges.request({
      staffId: staff.id,
      writeMode: body.writeMode,
      autoCategories: body.autoCategories ?? [],
      reason: body.reason,
    });
  }

  @Post('channel/mode/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({ summary: 'Step 2 of 2 — verify the code and apply the change.' })
  confirmModeChange(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: ConfirmModeChangeDto,
  ): Promise<ChannelSettingsView> {
    return this.challenges.confirm({
      staffId: staff.id,
      challengeId: body.challengeId,
      code: body.code,
    });
  }

  @Post('channel/pause')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'One-click pause. Does NOT change the chosen write mode — health and intent are separate, so resuming restores what was actually chosen.',
  })
  pause(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: PauseChannelDto,
  ): Promise<ChannelSettingsView> {
    return this.settings.pause({
      until: new Date(Date.now() + body.minutes * 60_000),
      reason: body.reason,
      staffId: staff.id,
    });
  }

  @Post('channel/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({ summary: 'Clear the pause. The previously chosen mode comes back untouched.' })
  resume(@CurrentStaff() staff: AuthenticatedStaff): Promise<ChannelSettingsView> {
    return this.settings.resume({ staffId: staff.id });
  }
}
