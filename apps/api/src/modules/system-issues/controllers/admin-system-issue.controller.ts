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
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { SystemIssueNotifier } from '../services/system-issue-notifier.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ActorType } from '@skydrop/db';
import { SystemIssueService } from '../services/system-issue.service';

export class ResolveIssueDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note!: string;
}

export class AcknowledgeIssueDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * Everything the system cannot fix by itself, in one list.
 *
 * Gated on `system.settings.view` rather than a narrower permission
 * because an issue can come from anywhere — a courier login, a cost
 * sync, a stalled poll — and a list that only some of them can see is a
 * list where the rest get missed.
 */
@ApiTags('admin-system-issues')
@ApiBearerAuth()
@Controller('admin/system-issues')
@UseGuards(StaffJwtGuard)
export class AdminSystemIssueController {
  constructor(
    private readonly svc: SystemIssueService,
    private readonly notifier: SystemIssueNotifier,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('system.settings.view')
  @ApiOperation({ summary: 'Open issues, worst first. Pass includeResolved=true for the history.' })
  list(@Query('includeResolved') includeResolved?: string): ReturnType<SystemIssueService['list']> {
    return this.svc.list({ includeResolved: includeResolved === 'true' });
  }

  @Post('announce-unnotified')
  @RequirePermissions('system.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Tell people about open issues nobody was ever told about. Safe to re-run — the dedup key is the issue, so a second run announces nothing.',
  })
  async announceUnnotified(
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ open: number; announced: number; alreadyAnnounced: number }> {
    const result = await this.notifier.announceUnnotified();
    // Audited because it reaches real people. MEDIUM rather than HIGH:
    // it is a catch-up on notifications that should already have gone,
    // not a new thing being said.
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staff.id,
      action: 'system_issue.announced_unnotified',
      entityType: 'system_issue',
      entityId: staff.id,
      severity: 'MEDIUM',
      metadata: { ...result },
    });
    return result;
  }

  @Post(':id/acknowledge')
  @RequirePermissions('system.settings.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record that somebody is on it. Does NOT close it — only the problem going away does.',
  })
  acknowledge(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<SystemIssueService['acknowledge']> {
    return this.svc.acknowledge(id, staff.id);
  }

  @Post(':id/resolve')
  @RequirePermissions('system.settings.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close it, with a note saying what was done.' })
  resolve(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() body: ResolveIssueDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<SystemIssueService['resolve']> {
    return this.svc.resolve(id, staff.id, body.note);
  }
}
