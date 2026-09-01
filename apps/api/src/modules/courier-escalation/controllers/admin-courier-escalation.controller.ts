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
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { CourierSupportRegistryService } from '../services/courier-support-registry.service';
import type { CapabilityFlags } from '../../courier-shared/services/courier-support-adapter';
import {
  ConfirmModeChangeDto,
  ListOutboxQueryDto,
  MarkSentDto,
  OpenEscalationDto,
  PauseChannelDto,
  PostReplyDto,
  PromoteCandidateDto,
  RecordInboundDto,
  RejectCandidateDto,
  RequestModeChangeDto,
} from '../dto/courier-ops.dto';
import {
  CourierEscalationService,
  type EscalationView,
} from '../services/courier-escalation.service';
import {
  CourierTemplateReviewService,
  type CandidateView,
  type TemplateView,
} from '../services/courier-template-review.service';
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
    private readonly registry: CourierSupportRegistryService,
    private readonly escalations: CourierEscalationService,
    private readonly templates: CourierTemplateReviewService,
    private readonly prisma: PrismaService,
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
    readonly capabilities: CapabilityFlags;
    /** Every courier's, so the console can say which desk is readable
     *  rather than implying one answer covers both. */
    readonly capabilitiesByCourier: Readonly<Record<string, CapabilityFlags | null>>;
    readonly lockedCategoryLabels: readonly string[];
    readonly counts: OpsQueueCounts;
  }> {
    const [settings, counts] = await Promise.all([this.settings.get(), this.queue.counts()]);
    return {
      settings,
      // Surfaced so the console can explain WHY nothing is automated:
      // with every write capability false, AUTO would change nothing.
      // Delhivery's, because the settings block above is Delhivery's:
      // this endpoint answers about ONE channel and the console reads it
      // that way. The per-courier view is `capabilitiesByCourier`, kept
      // as a separate field so the existing shape does not change
      // meaning under a caller that has not been updated.
      capabilities: this.registry.for('delhivery')?.capabilities() ?? {
        getThread: false,
        listUpdatedSince: false,
        getTaxonomy: false,
        postComment: false,
        raiseTicket: false,
      },
      capabilitiesByCourier: Object.fromEntries(
        this.registry
          .known()
          .map((code) => [code, this.registry.for(code)?.capabilities() ?? null]),
      ),
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
  // ── the conversation ────────────────────────────────────────────────

  @Get('escalations')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({
    summary: 'Open courier conversations, most recently active first.',
  })
  async escalationList(): Promise<
    readonly {
      id: string;
      awbNumber: string | null;
      externalTicketId: string | null;
      state: string | null;
      lastMessageAt: Date | null;
      needsReviewAt: Date | null;
      sellerName: string | null;
      messageCount: number;
    }[]
  > {
    const rows = await this.prisma.client.courierEscalation.findMany({
      orderBy: [{ needsReviewAt: 'desc' }, { lastMessageAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        awbNumber: true,
        externalTicketId: true,
        state: true,
        lastMessageAt: true,
        needsReviewAt: true,
        ticket: { select: { seller: { select: { companyName: true } } } },
        _count: { select: { messages: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      awbNumber: r.awbNumber,
      externalTicketId: r.externalTicketId,
      state: r.state,
      lastMessageAt: r.lastMessageAt,
      needsReviewAt: r.needsReviewAt,
      sellerName: r.ticket.seller?.companyName ?? null,
      messageCount: r._count.messages,
    }));
  }

  @Get('escalations/:escalationId')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({ summary: 'The full thread — verbatim, oldest first.' })
  escalationThread(
    @Param('escalationId', new ParseUUIDPipe({ version: '7' })) escalationId: string,
  ): Promise<EscalationView> {
    // No sellerId: an operator sees every conversation.
    return this.escalations.thread(escalationId);
  }

  @Post('escalations/:escalationId/reply')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({ summary: "Reply to the courier on the seller's behalf. Stored verbatim." })
  escalationReply(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('escalationId', new ParseUUIDPipe({ version: '7' })) escalationId: string,
    @Body() body: PostReplyDto,
  ): Promise<{ messageId: string; outboxItemId: string | null }> {
    return this.escalations.postReply({ escalationId, body: body.body, staffId: staff.id });
  }

  @Post('escalations/:escalationId/inbound')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      "Record what the courier told us, so the seller can see it. Their words, not ours — this is shown on the seller's ticket as the courier's reply.",
  })
  recordInbound(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('escalationId', new ParseUUIDPipe({ version: '7' })) escalationId: string,
    @Body() body: RecordInboundDto,
  ): Promise<{ messageId: string }> {
    return this.escalations.recordInbound({
      escalationId,
      body: body.body,
      staffId: staff.id,
      ...(body.occurredAt === undefined ? {} : { occurredAt: new Date(body.occurredAt) }),
    });
  }

  @Post('tickets/:ticketId/open')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'Start a courier conversation on a ticket that does not have one — a seller-raised issue, or a re-attempt whose thread failed to open. Idempotent: an existing thread is returned rather than a second one created.',
  })
  openForTicket(
    @Param('ticketId', new ParseUUIDPipe({ version: '7' })) ticketId: string,
    @Body() body: OpenEscalationDto,
  ): Promise<{ id: string; created: boolean }> {
    return this.escalations.openForTicket({
      ticketId,
      awbNumber: body.awbNumber ?? null,
      ...(body.courierCode === undefined ? {} : { courierCode: body.courierCode }),
    });
  }

  // ── the promotion queue ─────────────────────────────────────────────

  @Get('template-candidates')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({
    summary:
      'Messages the regex library could not classify, most-repeated first. This is how the library grows.',
  })
  candidates(): Promise<CandidateView[]> {
    return this.templates.listCandidates();
  }

  @Get('templates')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({ summary: 'The live pattern library, in match order.' })
  templateList(): Promise<TemplateView[]> {
    return this.templates.listTemplates();
  }

  @Post('template-candidates/:candidateId/promote')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({
    summary:
      'Turn an unmatched message into a live pattern. The pattern must compile AND match the body it came from.',
  })
  promote(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('candidateId', new ParseUUIDPipe({ version: '7' })) candidateId: string,
    @Body() body: PromoteCandidateDto,
  ): Promise<TemplateView> {
    return this.templates.promote({
      candidateId,
      code: body.code,
      pattern: body.pattern,
      state: body.state,
      action: body.action ?? null,
      ...(body.priority === undefined ? {} : { priority: body.priority }),
      notes: body.notes ?? null,
      staffId: staff.id,
    });
  }

  @Post('template-candidates/:candidateId/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('courier.ops.write')
  @ApiOperation({ summary: 'Looked at, deliberately not promoted.' })
  async rejectCandidate(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('candidateId', new ParseUUIDPipe({ version: '7' })) candidateId: string,
    @Body() body: RejectCandidateDto,
  ): Promise<{ ok: true }> {
    await this.templates.reject({ candidateId, staffId: staff.id, notes: body.notes ?? null });
    return { ok: true };
  }

  // ── what the portal worker has been doing ───────────────────────────

  @Get('portal-runs')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({
    summary:
      'What the portal worker did, or in SHADOW would have done. The only way to read shadow output.',
  })
  portalRuns(): Promise<
    readonly {
      id: string;
      kind: string;
      mode: string;
      outcome: string;
      detail: string | null;
      startedAt: Date;
    }[]
  > {
    return this.prisma.client.courierPortalRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
      select: { id: true, kind: true, mode: true, outcome: true, detail: true, startedAt: true },
    });
  }

  @Get('taxonomy')
  @RequirePermissions('courier.ops.view')
  @ApiOperation({
    summary:
      "Delhivery's fetched category tree. Empty until the portal has read it, which is why the auto list stays refused.",
  })
  taxonomy(): Promise<
    readonly {
      externalId: string;
      label: string;
      isHumanOnly: boolean;
      lastSeenAt: Date;
    }[]
  > {
    return this.prisma.client.courierIssueCategory.findMany({
      orderBy: [{ isHumanOnly: 'desc' }, { label: 'asc' }],
      select: { externalId: true, label: true, isHumanOnly: true, lastSeenAt: true },
    });
  }
}
