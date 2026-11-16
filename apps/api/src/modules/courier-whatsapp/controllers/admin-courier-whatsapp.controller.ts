import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import {
  CourierWhatsappReadService,
  type CourierWhatsappView,
} from '../services/courier-whatsapp-read.service';
import {
  FakeAttemptTicketService,
  type FakeAttemptResult,
} from '../services/fake-attempt-ticket.service';
import {
  CourierWhatsappRequestService,
  type WhatsappRequestOutcome,
} from '../services/courier-whatsapp-request.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/** Staff: every order. */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminCourierWhatsappController {
  constructor(
    private readonly read: CourierWhatsappReadService,
    private readonly request: CourierWhatsappRequestService,
    private readonly fakeAttempt: FakeAttemptTicketService,
  ) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer (read off its panel)' })
  get(@Param('id', uuid()) id: string): Promise<CourierWhatsappView> {
    return this.read.forOrder(id, { sellerId: null });
  }

  @Post(':id/courier-messages/refresh')
  // Enqueues a read-only portal job; still a WRITE verb, so not behind `.view` alone.
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the portal worker to read the courier WhatsApp window again' })
  async refresh(@Param('id', uuid()) id: string): Promise<WhatsappRequestOutcome> {
    const view = await this.read.forOrder(id, { sellerId: null });
    if (view.shipmentId === null) return { queued: false, reason: 'NOT_DELHIVERY' };
    return this.request.request(view.shipmentId, { kind: 'viewer' });
  }

  @Post(':id/courier-ndr/fake-attempt-ticket')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Raise (once) the fake-delivery-attempt ticket when the NDR remark is not verified',
  })
  async raiseFakeAttempt(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
  ): Promise<FakeAttemptResult> {
    const view = await this.read.forOrder(id, { sellerId: null });
    if (view.shipmentId === null) {
      throw new NotFoundException({
        code: 'SHIPMENT_NOT_FOUND',
        message: 'No parcel for this order',
      });
    }
    return this.fakeAttempt.raise(view.shipmentId, staff.id);
  }
}
