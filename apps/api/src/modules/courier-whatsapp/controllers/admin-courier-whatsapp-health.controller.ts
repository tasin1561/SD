import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  CourierWhatsappHealthService,
  type CourierWhatsappHealth,
} from '../services/courier-whatsapp-health.service';

/** How the reader is doing: reads and failures today, backlog age. */
@ApiTags('admin-courier')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.ops.view')
@Controller('admin/courier/whatsapp-health')
export class AdminCourierWhatsappHealthController {
  constructor(private readonly health: CourierWhatsappHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Courier WhatsApp reader health' })
  get(): Promise<CourierWhatsappHealth> {
    return this.health.snapshot();
  }
}
