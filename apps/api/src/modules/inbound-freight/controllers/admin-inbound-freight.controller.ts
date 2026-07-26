import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@skydrop/db';
import { requireStaffRoles } from '../../../common/auth/require-staff-roles';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  ListInboundFreightQueryDto,
  RecordInboundFreightDto,
  WaiveInboundFreightDto,
} from '../dto/inbound-freight.dto';
import {
  InboundFreightService,
  type FreightChargeView,
} from '../services/inbound-freight.service';

/**
 * R3 admin surface — recording and resolving the BD→India freight bill.
 *
 * RBAC is enforced INSIDE each handler via `requireStaffRoles` (the M9
 * pattern): recording and settling move money, so they are limited to
 * finance/super-admin rather than any authenticated staff member.
 */
@ApiTags('admin-inbound-freight')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('admin/inbound-freight')
export class AdminInboundFreightController {
  constructor(private readonly svc: InboundFreightService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List inbound freight bills (optionally by seller / status)' })
  list(
    @Query() query: ListInboundFreightQueryDto,
  ): Promise<readonly FreightChargeView[]> {
    return this.svc.listForAdmin({
      ...(query.sellerId === undefined ? {} : { sellerId: query.sellerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Record the freight invoice for a consignment. PAY_NOW debits the wallet in the same transaction; PAY_LATER leaves a PENDING receivable. Idempotent per goods receipt (409 FREIGHT_ALREADY_RECORDED).',
  })
  record(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() body: RecordInboundFreightDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<FreightChargeView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.record(
      staff.id,
      {
        goodsReceiptId: body.goodsReceiptId,
        amountInr: body.amountInr,
        ...(body.mode === undefined ? {} : { mode: body.mode }),
        ...(body.note === undefined ? {} : { note: body.note }),
      },
      ctx,
    );
  }

  @Post(':freightChargeId/settle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Settle a PENDING (pay-later) bill against the wallet. Guarded in-tx so two operators cannot double-debit.',
  })
  settle(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('freightChargeId', new ParseUUIDPipe({ version: '7' }))
    freightChargeId: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<FreightChargeView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.settle(staff.id, freightChargeId, ctx);
  }

  @Post(':freightChargeId/waive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Forgive a PENDING bill. No wallet movement; audited HIGH — this is money we chose not to collect.',
  })
  waive(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('freightChargeId', new ParseUUIDPipe({ version: '7' }))
    freightChargeId: string,
    @Body() body: WaiveInboundFreightDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<FreightChargeView> {
    requireStaffRoles(staff, [StaffRole.FINANCE, StaffRole.SUPER_ADMIN]);
    return this.svc.waive(staff.id, freightChargeId, body.reason, ctx);
  }
}
