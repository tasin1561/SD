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
import { BadRequestException } from '@nestjs/common';
import { ClientInfo } from '../../../common/decorators/client-info.decorator';
import type { ClientInfoPayload } from '../../../common/decorators/client-info.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { DecideDeliveryActionDto, ListDeliveryActionsQueryDto } from '../dto/delivery-action.dto';
import { DeliveryActionDecisionService } from '../services/delivery-action-decision.service';

/**
 * The operator gate (CUR-10).
 *
 * A seller's request arrives here and a person decides. Approving a
 * re-attempt dispatches a van; approving an RTO turns a moving parcel
 * into a return. Neither is something a seller-facing handler may do on
 * its own, which is the whole reason this queue exists.
 */
@ApiTags('admin-delivery-actions')
@ApiBearerAuth()
@UseGuards(StaffJwtGuard)
@Controller('admin/delivery-actions')
export class AdminDeliveryActionController {
  constructor(private readonly svc: DeliveryActionDecisionService) {}

  @Get()
  @RequirePermissions('orders.view')
  @ApiOperation({ summary: 'What sellers have asked for, oldest first' })
  list(@Query() query: ListDeliveryActionsQueryDto): Promise<unknown[]> {
    return this.svc.list(query.status);
  }

  @Post(':requestId/approve')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve and carry it out. A re-attempt or RTO reaches Delhivery; a recall enqueues the order for our own agents.',
  })
  approve(
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): ReturnType<DeliveryActionDecisionService['approve']> {
    return this.svc.approve(staff.id, requestId, body.note ?? null, ctx);
  }

  @Post(':requestId/reject')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline it. The reason is shown to the seller.' })
  reject(
    @Param('requestId', new ParseUUIDPipe({ version: '7' })) requestId: string,
    @Body() body: DecideDeliveryActionDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<DeliveryActionDecisionService['reject']> {
    // Required here rather than on the DTO, which is shared with
    // approve — where a note is genuinely optional. A refusal a seller
    // cannot understand is one they will simply raise again.
    const note = body.note?.trim() ?? '';
    if (note.length < 5) {
      throw new BadRequestException({
        code: 'DELIVERY_ACTION_REASON_REQUIRED',
        message: 'Say why. The seller sees this, and an unexplained no comes straight back.',
      });
    }
    return this.svc.reject(staff.id, requestId, note);
  }
}
