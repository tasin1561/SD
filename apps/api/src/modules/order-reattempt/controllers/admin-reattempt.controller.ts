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
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  OrderReattemptService,
  type ReattemptRequestView,
} from '../services/order-reattempt.service';
import {
  DecideReattemptRequestDto,
  ListReattemptRequestsQueryDto,
} from '../dto/order-reattempt.dto';

/**
 * The human between "the seller wants another go" and "we ring somebody
 * who declined". Approving is what makes the one edge out of
 * REJECTED_BY_CUSTOMER reachable.
 */
@ApiTags('admin-order-reattempt')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/reattempt-requests')
export class AdminReattemptController {
  constructor(private readonly svc: OrderReattemptService) {}

  @Get()
  @RequirePermissions('callcenter.queue.manage')
  @ApiOperation({ summary: 'Sellers asking to call a declined customer again' })
  list(@Query() query: ListReattemptRequestsQueryDto): Promise<ReattemptRequestView[]> {
    return this.svc.listForAdmin(query.status);
  }

  @Post(':requestId/approve')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve — returns the order to the call queue' })
  approve(
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideReattemptRequestDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ReattemptRequestView> {
    return this.svc.approve(requestId, staff.id, body.note ?? null);
  }

  @Post(':requestId/reject')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline the request — the order stays rejected' })
  reject(
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideReattemptRequestDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ReattemptRequestView> {
    return this.svc.reject(requestId, staff.id, body.note ?? null);
  }
}
