import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { UpdateAgentSettingsDto } from '../dto/update-agent-settings.dto';
import { AgentSettingsService, type AgentSettingsView } from '../services/agent-settings.service';
import {
  AdminAgentService,
  type AgentDetail,
  type AgentListRow,
  type AgentMetrics,
} from '../services/admin-agent.service';

/**
 * Admin views/controls over call agents (decision 11). Settings WRITES
 * delegate to AgentSettingsService.updateAsAdmin — the single source
 * for the 10c agent/admin field split (admin may set any field, MEDIUM
 * audit). Staff JWT only; admin-only role scoping deferred to RBAC.
 */
@ApiTags('admin-agents')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/agents')
export class AdminAgentController {
  constructor(
    private readonly agents: AdminAgentService,
    private readonly settings: AgentSettingsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All call agents + effective settings + live ASSIGNED count' })
  list(): Promise<AgentListRow[]> {
    return this.agents.listAgents();
  }

  @Get(':staffUserId')
  @ApiOperation({ summary: 'Agent detail: identity + settings + summary metrics' })
  detail(
    @Param('staffUserId', new ParseUUIDPipe({ version: '7' }))
    staffUserId: string,
  ): Promise<AgentDetail> {
    return this.agents.getDetail(staffUserId);
  }

  @Get(':staffUserId/metrics')
  @ApiOperation({ summary: 'Per-agent SUMMARY metrics (decision 12)' })
  metrics(
    @Param('staffUserId', new ParseUUIDPipe({ version: '7' }))
    staffUserId: string,
  ): Promise<AgentMetrics> {
    return this.agents.getMetrics(staffUserId);
  }

  @Patch(':staffUserId/settings')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin edits any agent setting (incl. the 10a cap)' })
  updateSettings(
    @Param('staffUserId', new ParseUUIDPipe({ version: '7' }))
    staffUserId: string,
    @Body() body: UpdateAgentSettingsDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AgentSettingsView> {
    return this.settings.updateAsAdmin(staffUserId, body, staff.id, ctx);
  }
}
