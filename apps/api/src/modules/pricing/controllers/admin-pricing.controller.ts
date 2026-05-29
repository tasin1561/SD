import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { PreviewPricingDto } from '../dto/preview-pricing.dto';
import {
  PricingEngineService,
  type PricingComputeOutput,
} from '../services/pricing-engine.service';

@ApiTags('admin-pricing')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/pricing')
export class AdminPricingController {
  constructor(private readonly engine: PricingEngineService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Preview the pricing breakdown for a hypothetical order (no persistence).',
  })
  preview(@Body() body: PreviewPricingDto): Promise<PricingComputeOutput> {
    return this.engine.compute(body);
  }
}
