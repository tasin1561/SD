import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActorType } from '@skydrop/db';
import type { Response } from 'express';

import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { BulkOrderIdsDto } from '../../../common/bulk/bulk-order.dto';
import type { BulkOrderResponse } from '../../../common/bulk/bulk-result';
import { sendCsv } from '../../../common/bulk/send-csv';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { BulkOrderExportService } from '../../bulk-order-actions/services/bulk-order-export.service';
import { AdminBulkExportDto } from '../dto/bulk-order-export.dto';
import { BulkOrderConfirmationService } from '../services/bulk-order-confirmation.service';
import { OrderService } from '../services/order.service';

/**
 * Bulk order actions for staff (Phase A). Each route asks for the key the
 * single-order action asks for. Staff are not narrowed to a seller, so the
 * scope here is "not deleted" — the same as the admin list.
 */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders/bulk')
export class AdminOrderBulkController {
  constructor(
    private readonly confirmations: BulkOrderConfirmationService,
    private readonly exporter: BulkOrderExportService,
    private readonly orders: OrderService,
    private readonly audit: AuditLogService,
  ) {}

  @Post('confirmation-calls')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send chosen awaiting-confirmation orders to the call queue — the bulk shape of POST /admin/orders/confirmation-calls. Per-order DONE / SKIPPED / FAILED.',
  })
  sendConfirmationCalls(
    @Body() body: BulkOrderIdsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkOrderResponse> {
    return this.confirmations.sendCalls(body.orderIds, { ctx });
  }

  @Post('confirm-without-call')
  @RequirePermissions('callcenter.queue.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm chosen orders now with no call — the bulk shape of POST /admin/orders/confirm-without-call. Same reserve saga; an order with nothing in stock is SKIPPED OUT_OF_STOCK.',
  })
  confirmWithoutCall(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: BulkOrderIdsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<BulkOrderResponse> {
    return this.confirmations.confirmWithoutCall(body.orderIds, {
      actor: { type: ActorType.STAFF, id: staff.id },
      ctx,
    });
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Download chosen orders (orderIds) or every order a list filter matches (filter) as a CSV with the client named, at most 5000 rows. Audited.',
  })
  async export(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: AdminBulkExportDto,
    @Res() res: Response,
  ): Promise<void> {
    const ids = await this.exporter.collectIds(body, (f) => this.orders.adminList(f));
    const out = await this.exporter.build({ audience: 'ADMIN', scope: {}, orderIds: ids });
    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: staff.id,
      action: 'orders.bulk_export',
      entityType: 'order',
      entityId: null,
      severity: 'LOW',
      metadata: { rowCount: out.rowCount, byFilter: body.filter !== undefined },
    });
    sendCsv(res, out);
  }
}
