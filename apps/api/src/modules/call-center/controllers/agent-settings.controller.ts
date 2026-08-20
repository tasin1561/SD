import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentPresenceService } from '../services/agent-presence.service';
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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Agent self-service for their own call settings (locked decision 10c).
 * Staff JWT only — broad role scoping (CALL_AGENT-only) lands with the
 * RBAC module (same Phase-1A posture as the admin-seller controller).
 * The agent-editable vs admin-only FIELD split IS enforced now, in
 * AgentSettingsService.
 */
@ApiTags('agent-call-settings')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('callcenter.work')
@Controller('agent/settings')
export class AgentSettingsController {
  constructor(
    private readonly svc: AgentSettingsService,
    private readonly presence: AgentPresenceService,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Agent is still at the desk — renews presence, never grants it',
  })
  async heartbeat(@CurrentStaff() staff: AuthenticatedStaff): Promise<void> {
    await this.presence.touch(staff.id);
  }

  @Get()
  @ApiOperation({ summary: "The calling agent's effective call settings" })
  get(@CurrentStaff() staff: AuthenticatedStaff): Promise<AgentSettingsView> {
    return this.svc.get(staff.id);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Agent edits own advisory settings (admin-only fields → 403 FIELD_ADMIN_ONLY)',
  })
  update(
    @Body() body: UpdateAgentSettingsDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<AgentSettingsView> {
    return this.svc.updateSelf(staff.id, body, ctx);
  }
}
