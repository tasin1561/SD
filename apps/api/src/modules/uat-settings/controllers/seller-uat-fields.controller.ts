import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerSelfService } from '../../../common/auth/require-seller-permissions.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { UatFieldsService, type UatField } from '../services/uat-fields.service';

/**
 * Which order-form fields the client console should render.
 *
 * Read-only and unpermissioned beyond being signed in: it says whether
 * a FIELD is on a form, which is not a secret and which every order
 * page needs before it can draw. `SellerAuthAllowSuspended` because a
 * suspended client can still read their orders, and a form that cannot
 * decide what to draw is worse than one it cannot submit.
 */
@ApiTags('seller-uat-fields')
@SellerSelfService()
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@Controller('seller/uat-fields')
export class SellerUatFieldsController {
  constructor(private readonly fields: UatFieldsService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'Which UAT-controlled fields the order forms should show.' })
  async all(): Promise<Readonly<Record<UatField, boolean>>> {
    return this.fields.all();
  }
}
