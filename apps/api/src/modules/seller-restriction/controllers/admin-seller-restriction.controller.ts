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
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ApplyRestrictionDto, LiftRestrictionDto } from '../dto/seller-restriction.dto';
import {
  SellerRestrictionService,
  type ActiveRestriction,
} from '../services/seller-restriction.service';

/**
 * Placing a seller on hold, and taking them off it.
 *
 * Gated on `sellers.suspend` rather than a money permission. A hold IS a
 * partial suspension — it stops an account trading — and whoever is
 * trusted to suspend outright is the right person to stop them placing
 * orders. Reusing the key also means nobody has to be granted something
 * new before this works.
 */
@ApiTags('admin-seller-restriction')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@Controller('admin/sellers/:sellerId/restriction')
export class AdminSellerRestrictionController {
  constructor(private readonly svc: SellerRestrictionService) {}

  @Get()
  @RequirePermissions('sellers.view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The hold in force on this seller, if any' })
  active(@Param('sellerId') sellerId: string): Promise<ActiveRestriction | null> {
    return this.svc.activeFor(sellerId);
  }

  @Post()
  @RequirePermissions('sellers.suspend')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place this seller on hold' })
  apply(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('sellerId') sellerId: string,
    @Body() body: ApplyRestrictionDto,
  ): Promise<{ id: string }> {
    return this.svc.apply({
      sellerId,
      capabilities: body.capabilities,
      clearAtBalanceInr: body.clearAtBalanceInr,
      reason: body.reason,
      staffId: staff.id,
    });
  }

  @Post(':restrictionId/lift')
  @RequirePermissions('sellers.suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lift the hold by hand, before the balance gets there' })
  async lift(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('restrictionId') restrictionId: string,
    @Body() body: LiftRestrictionDto,
  ): Promise<{ lifted: true }> {
    await this.svc.lift({ restrictionId, staffId: staff.id, reason: body.reason });
    return { lifted: true };
  }
}
