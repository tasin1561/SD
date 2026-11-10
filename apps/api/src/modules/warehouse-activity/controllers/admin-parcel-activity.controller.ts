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
import {
  ParcelActivityService,
  type ParcelActivityTrail,
} from '../services/parcel-activity.service';

/** uuidv7, as every other admin order route validates it. */
const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Who did what to this order's parcels.
 *
 * ── THE PERMISSION, AND WHY THIS ONE ─────────────────────────────────
 * `orders.view` — the SAME class gate as `AdminOrderController` and
 * `AdminOrderJourneyController`, the two surfaces this trail renders
 * beside. It is deliberately not a looser key: the trail is read on the
 * admin order page, so anybody who can open that page can already see
 * every fact it assembles, and a separate key would only mean a section
 * that 403s inside a page that rendered. It is deliberately not a
 * TIGHTER one either — a warehouse supervisor asking "who packed this"
 * is the ordinary reader, and `orders.view` is what the Read-only tier
 * holds.
 *
 * Staff consoles ONLY. There is no seller, store or associate route for
 * this: which of OUR people touched a parcel is our operational record,
 * not the client's, and the seller journey (`order-journey`) is the
 * client-facing story.
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminParcelActivityController {
  constructor(private readonly activity: ParcelActivityService) {}

  @Get(':id/parcel-activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Every warehouse action on this order's parcels, in order — what happened, which staff member did it, and when",
  })
  forOrder(@Param('id', uuid()) id: string): Promise<ParcelActivityTrail> {
    // No seller scope: staff read every order, as on the journey route.
    return this.activity.forOrder(id);
  }
}
