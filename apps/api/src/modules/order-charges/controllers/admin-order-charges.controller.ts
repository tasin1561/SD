import {
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
import {
  OrderChargesService,
  type OrderChargeView,
  type PersistChargesResult,
} from '../services/order-charges.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

@ApiTags('admin-order-charges')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/orders/:orderId/charges')
export class AdminOrderChargesController {
  constructor(private readonly svc: OrderChargesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all OrderCharge rows for an order (admin view, all visibility levels)' })
  list(@Param('orderId', uuid()) orderId: string): Promise<readonly OrderChargeView[]> {
    return this.svc.listForOrderAdmin(orderId);
  }

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Compute charges via PricingEngineService + persist as OrderCharge rows (status=ESTIMATED). Idempotency-gated: rejects if charges already exist.',
  })
  compute(
    @Param('orderId', uuid()) orderId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<PersistChargesResult> {
    return this.svc.persistForOrder(orderId, staff.id);
  }
}
