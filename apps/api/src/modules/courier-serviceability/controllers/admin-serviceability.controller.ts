import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { CheckServiceabilityQueryDto } from '../dto/serviceability.dto';
import { OrderServiceabilityService } from '../services/order-serviceability.service';

/**
 * The same question, asked by an agent with the customer on the line.
 *
 * This is the last cheap moment. Stock has not been reserved, no AWB has
 * been bought, and the one person who can fix a bad address is talking
 * to the one person who knows it. After confirmation the discovery costs
 * a picked parcel and a rejected AWB (CUR-5, reactive).
 *
 * It does NOT block the confirmation. Blocking would strand the agent
 * mid-call with no path forward — they would have a customer, a refusal,
 * and no way to record either. Telling them means they can ask for
 * somewhere else and confirm against that.
 */
@ApiTags('admin-serviceability')
@ApiBearerAuth()
@UseGuards(StaffJwtGuard)
@Controller('admin/serviceability')
export class AdminServiceabilityController {
  constructor(private readonly svc: OrderServiceabilityService) {}

  @Get()
  // Either. An agent working the call queue is exactly who needs this
  // answer and may hold no order permission at all — refusing them
  // would leave the check visible only to people not on the phone.
  @RequirePermissions('orders.view', 'callcenter.work')
  @ApiOperation({
    summary:
      'Whether our courier delivers to a pincode. Advisory — it never blocks a confirmation.',
  })
  check(
    @Query() query: CheckServiceabilityQueryDto,
  ): ReturnType<OrderServiceabilityService['check']> {
    return this.svc.check({
      pincode: query.pincode,
      paymentMode: query.paymentMode,
      ...(query.codAmountInr === undefined ? {} : { codAmountInr: Number(query.codAmountInr) }),
    });
  }
}
