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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AssistantControlDto, AssistantExplorerQueryDto } from '../dto/assistant.dto';
import { AssistantBillingService } from '../services/assistant-billing.service';
import { AssistantMonitorPanelService } from '../services/assistant-monitor-panel.service';
import { AssistantPanelService } from '../services/assistant-panel.service';
import { AssistantMonitorWorker } from '../queue/assistant-monitor.worker';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The AI control panel's API (Super Admin only by default). Two keys, both
 * enforced HERE on every handler; the console hides pages by the same keys
 * but that is cosmetic (FE-2).
 *
 *  - `assistant.admin`: billing, dashboard, controls.
 *  - `assistant.conversations.read`: the conversation explorer. Every open,
 *    reveal and download is written to `audit_logs` BEFORE data is returned.
 */
@ApiTags('admin-assistant-panel')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('assistant.admin')
@Controller('admin/assistant-panel')
export class AdminAssistantPanelController {
  constructor(
    private readonly billing: AssistantBillingService,
    private readonly panel: AssistantPanelService,
    private readonly monitor: AssistantMonitorPanelService,
    private readonly monitorWorker: AssistantMonitorWorker,
  ) {}

  @Get('billing/monthly')
  @ApiOperation({ summary: 'AI cost month by month (Asia/Dhaka months)' })
  monthly(@Query('months') months?: string) {
    return this.billing.monthly(months === undefined ? 12 : Number(months));
  }

  @Get('billing/daily')
  @ApiOperation({ summary: 'AI cost day by day for one month (YYYY-MM)' })
  daily(@Query('month') month?: string) {
    if (month === undefined)
      throw new BadRequestException({ code: 'BAD_MONTH', message: 'month is required' });
    return this.billing.daily(month);
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Usage dashboard for a date range' })
  dashboard(@Query('from') from?: string, @Query('to') to?: string) {
    return this.panel.dashboard(from, to);
  }

  @Get('controls')
  @ApiOperation({ summary: 'Current assistant switches and limits' })
  controls() {
    return this.panel.controls();
  }

  @Put('controls/:key')
  @ApiOperation({
    summary: 'Change one assistant switch or limit (audited by the settings service)',
  })
  setControl(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('key') key: string,
    @Body() body: AssistantControlDto,
  ) {
    return this.panel.setControl(staff.id, key, body.value);
  }

  @Get('monitor')
  @ApiOperation({
    summary: 'Overnight monitor: runs, budget, themes, knowledge gaps (no conversation text)',
  })
  monitorOverview() {
    return this.monitor.overview();
  }

  @Get('monitor/flags')
  @RequirePermissions('assistant.conversations.read')
  @ApiOperation({ summary: 'Conversations the monitor flagged for safety, newest first (audited)' })
  monitorFlags(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.monitor.flags(staff.id);
  }

  @Post('monitor/run-now')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue a monitor pass now (audited; refused while the monitor is off)' })
  monitorRunNow(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.monitor.requestRunNow(staff.id, () => this.monitorWorker.enqueueRunNow());
  }

  @Get('conversations')
  @RequirePermissions('assistant.conversations.read')
  @ApiOperation({ summary: 'Conversation explorer (phones masked)' })
  list(@Query() q: AssistantExplorerQueryDto) {
    return this.panel.list(q);
  }

  @Get('conversations/:id')
  @RequirePermissions('assistant.conversations.read')
  @ApiOperation({ summary: 'Open one conversation (audited)' })
  open(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Query('reason') reason?: unknown,
  ) {
    return this.panel.open(staff.id, id, auditReason(reason));
  }

  @Post('conversations/:id/messages/:messageId/reveal')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('assistant.conversations.read')
  @ApiOperation({ summary: 'Show the phone numbers in one message (audited)' })
  reveal(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Param('messageId', uuid()) messageId: string,
    @Query('reason') reason?: unknown,
  ) {
    return this.panel.reveal(staff.id, id, messageId, auditReason(reason));
  }

  @Get('conversations/:id/attachments/:attachmentId/download')
  @RequirePermissions('assistant.conversations.read')
  @ApiOperation({ summary: 'Signed download of one attachment (audited)' })
  download(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Param('attachmentId', uuid()) attachmentId: string,
  ) {
    return this.panel.downloadAttachment(staff.id, id, attachmentId);
  }
}

/**
 * The optional "why" written into the audit row. A repeated query parameter
 * (`?reason=a&reason=b`) arrives as an ARRAY, not a string (CodeQL
 * js/type-confusion-through-parameter-tampering): only a plain string is
 * kept, trimmed to 300 characters; anything else is dropped.
 */
export function auditReason(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw.slice(0, 300) : undefined;
}
