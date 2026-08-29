import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { OrderJourneyService, type OrderJourney } from '../services/order-journey.service';

/** uuidv7, as every other order route validates it. */
const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The same journey, for staff — across every seller.
 *
 * Deliberately the SAME service rather than an admin-shaped copy: an
 * agent on the phone and the seller reading the page must be looking at
 * one story, or the call starts with reconciling two versions of it.
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminOrderJourneyController {
  constructor(private readonly journey: OrderJourneyService) {}

  @Get(':id/journey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Milestones, parcel facts and the merged Skydrop + courier timeline' })
  forOrder(@Param('id', uuid()) id: string): Promise<OrderJourney> {
    // No seller scope: staff see every order.
    return this.journey.forOrder(id, null);
  }
}
