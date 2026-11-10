import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { WarehouseHoldsService, type FloorHoldsView } from '../services/warehouse-holds.service';

/**
 * Who is holding what on the floor right now.
 *
 * ── THE PERMISSION, AND WHY THIS ONE ─────────────────────────────────
 * `warehouse.view` — the warehouse READ key, the same one the hub and
 * the bin screens take. The board changes nothing, and the people who
 * need it are exactly the people who may look at the warehouse: a picker
 * deciding what to take next, and a supervisor working out why a parcel
 * has not moved. Gating it on `warehouse.pack` or
 * `courier.dispatch.handoff` would hide the pack and handover holds from
 * the picker standing next to them, which is the conversation this page
 * exists to let them have.
 *
 * Staff consoles ONLY — a client has no business knowing which of our
 * people is holding a box.
 */
@ApiTags('admin-warehouse')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.view')
@Controller('admin/warehouse')
export class AdminWarehouseHoldsController {
  constructor(private readonly holds: WarehouseHoldsService) {}

  @Get('holds')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Live holds: who has a parcel claimed for picking or packing, who has a box open, who holds a printed picking sheet — with the clock time each hold lapses, and whether it already has',
  })
  list(): Promise<FloorHoldsView> {
    return this.holds.list();
  }
}
