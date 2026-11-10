import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { ParcelActivityService, type ParcelLastTouch } from '../services/parcel-activity.service';

/** As many parcels as a bench list shows at once, and no more. */
const MAX_IDS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who last touched each of these parcels — for a bench row.
 *
 * ── THE PERMISSION, AND WHY IT IS THREE KEYS ─────────────────────────
 * `@RequirePermissions(a, b, c)` is OR, and the three are the gates of
 * the three screens that render this line: the warehouse read key, the
 * pack bench's key and the handover bench's. A packer holds
 * `warehouse.pack` and need not hold `warehouse.view`; gating this on
 * the read key alone would 403 the one sentence on the screen they work
 * at all day. Nothing here is wider than what each of those screens
 * already shows its holder — it is one name and one time about a parcel
 * they are standing in front of.
 *
 * A SEPARATE controller from the holds board on purpose: a handler-level
 * `@RequirePermissions` on that class would WIDEN its class gate, and
 * `parcel-activity.spec.ts` pins that no handler there does.
 */
@ApiTags('admin-warehouse')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.view', 'warehouse.pack', 'courier.dispatch.handoff')
@Controller('admin/warehouse')
export class AdminParcelLastTouchController {
  constructor(private readonly activity: ParcelActivityService) {}

  @Get('parcel-last-touch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Who last touched each of these parcels, and when — one line per parcel for the pack and handover benches',
  })
  async forShipments(
    @Query('shipmentIds') shipmentIds?: string,
  ): Promise<{ items: readonly ParcelLastTouch[] }> {
    const ids = (shipmentIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (ids.length > MAX_IDS) {
      throw new BadRequestException({
        code: 'TOO_MANY_PARCELS',
        message: `Ask about at most ${MAX_IDS} parcels at a time`,
      });
    }
    // A malformed id is DROPPED rather than refusing the whole list: one
    // bad row must not blank the line on the other thirty-nine.
    const items = await this.activity.lastTouchFor(ids.filter((id) => UUID.test(id)));
    return { items };
  }
}
