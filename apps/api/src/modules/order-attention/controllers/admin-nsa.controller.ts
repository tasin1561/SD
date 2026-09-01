import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ParseUUIDPipe } from '@nestjs/common';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { OrderAttentionService } from '../services/order-attention.service';

export class AcknowledgeNsaDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

/**
 * OUR side of the NSA worklist.
 *
 * Deliberately a different page from the seller's, because the two are
 * doing different jobs with it: we ring the courier and need every
 * seller's parcels in one list, with a note recording who is already on
 * which one. The seller sees only their own and is deciding whether to
 * chase us.
 */
@ApiTags('admin-nsa')
@ApiBearerAuth()
@Controller('admin/nsa')
@UseGuards(StaffJwtGuard)
export class AdminNsaController {
  constructor(private readonly attention: OrderAttentionService) {}

  @Get()
  @RequirePermissions('orders.view')
  @ApiOperation({
    summary:
      'Orders still out for delivery past the evening cutoff, across every seller — worst first',
  })
  list(): ReturnType<OrderAttentionService['list']> {
    return this.attention.list();
  }

  @Post(':orderId/acknowledge')
  @RequirePermissions('orders.tracking.manual_scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record that somebody is chasing this one. Does NOT clear the flag — only the parcel moving does that.',
  })
  acknowledge(
    @Param('orderId', new ParseUUIDPipe({ version: '7' })) orderId: string,
    @Body() body: AcknowledgeNsaDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): ReturnType<OrderAttentionService['acknowledge']> {
    return this.attention.acknowledge(orderId, staff.id, body.note ?? null);
  }

  @Post('sweep')
  @RequirePermissions('orders.tracking.manual_scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Run the sweep now rather than waiting for the hourly tick. Idempotent per evening.',
  })
  sweep(): ReturnType<OrderAttentionService['sweep']> {
    return this.attention.sweep();
  }
}
