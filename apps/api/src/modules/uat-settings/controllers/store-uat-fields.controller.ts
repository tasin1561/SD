import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StoreSelfService } from '../../../common/auth/require-store-permissions.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { UatFieldsService, type UatField } from '../services/uat-fields.service';

/**
 * Which order-form fields the member-store and associate consoles
 * should render.
 *
 * One controller for both, because both already place orders through
 * `POST /store/orders` — they are two front ends on one store identity,
 * and a third path would be a second answer to the same question.
 *
 * Read-only, and no permission beyond being signed in: it says whether
 * a FIELD is on a form, which is not a secret and which every order
 * page needs before it can draw.
 */
@ApiTags('store-uat-fields')
@StoreSelfService()
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@Controller('store/uat-fields')
export class StoreUatFieldsController {
  constructor(private readonly fields: UatFieldsService) {}

  @Get()
  @ApiOperation({ summary: 'Which UAT-controlled fields the order forms should show.' })
  async all(): Promise<Readonly<Record<UatField, boolean>>> {
    return this.fields.all();
  }
}
