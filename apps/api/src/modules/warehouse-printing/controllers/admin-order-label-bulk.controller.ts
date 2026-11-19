import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BulkOrderIdsDto } from '../../../common/bulk/bulk-order.dto';
import { sendPdf } from '../../../common/bulk/send-pdf';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { BulkLabelService } from '../services/bulk-label.service';

/**
 * Bulk labels from the admin order list (Phase A). The key is the one the
 * single label print asks for (`warehouse.pick`); nothing here marks a parcel
 * printed — that stays the operator's explicit confirmation.
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.pick')
@Controller('admin/orders/bulk/labels')
export class AdminOrderLabelBulkController {
  constructor(private readonly bulk: BulkLabelService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'One merged PDF of the chosen orders’ labels (at most 200), through the existing label print. Orders with no parcel or no waybill are listed on a final "Not included" page.',
  })
  async labels(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: BulkOrderIdsDto,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.bulk.merge(body.orderIds, staff.id);
    sendPdf(res, {
      pdf: out.pdf,
      fileName: out.fileName,
      included: out.included,
      skipped: out.notIncluded.length,
    });
  }
}
