import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ChooseCourierDto } from '../dto/courier-decision.dto';
import { CourierDecisionService, type WaitingParcel } from '../services/courier-decision.service';

/**
 * CUR-17 — the courier decision desk.
 *
 * Its own controller rather than another handler on the order routes:
 * the question here is not about an order's lifecycle, it is "which of
 * these carriers", and the people who work this queue are not
 * necessarily the people who cancel orders or force statuses.
 */
@ApiTags('admin-courier-decisions')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.courier_choice')
@Controller('admin/courier-decisions')
export class AdminCourierDecisionController {
  constructor(private readonly decisions: CourierDecisionService) {}

  @Get()
  @ApiOperation({
    summary: 'Parcels waiting for somebody to pick a carrier',
    description:
      'Oldest first — the order a queue is worked in, and the one that makes the longest wait the most visible. Each carries the options that were quoted at confirmation, and when they were quoted.',
  })
  async list(): Promise<{ parcels: WaitingParcel[] }> {
    return { parcels: await this.decisions.listWaiting() };
  }

  @Post('shipments/:shipmentId/choose')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pick the carrier and book',
    description:
      'Stamps the choice, un-pauses the order and books immediately. Refused once a waybill exists — a second booking is a second real waybill and a second charge.',
  })
  async choose(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', ParseUUIDPipe) shipmentId: string,
    @Body() dto: ChooseCourierDto,
  ): Promise<{ orderId: string; result: string }> {
    return this.decisions.choose({
      shipmentId,
      courierCompanyId: dto.courierCompanyId,
      staffId: staff.id,
    });
  }

  @Post('sweep-expired')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Book everything that has waited too long',
    description:
      'The same sweep the scheduler runs, on demand. Picks the cheapest option for each parcel past the decision TTL and raises an issue saying so — choosing on somebody’s behalf should spend the least of their money, and it should never be quiet.',
  })
  async sweep(): Promise<{ picked: number; skipped: number }> {
    return this.decisions.sweepExpired();
  }
}
