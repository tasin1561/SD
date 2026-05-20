import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  RtoReceiptService,
  type ReceiveRtoResult,
} from '../services/rto-receipt.service';
import {
  RtoInspectionService,
  type InspectRtoItemResult,
} from '../services/rto-inspection.service';
import {
  RtoDispositionService,
  type FinalizeRtoResult,
} from '../services/rto-disposition.service';
import {
  InspectRtoItemDto,
  ReceiveRtoDto,
} from '../dto/warehouse-rto.dto';

/**
 * Warehouse RTO operator workflow (receive → inspect[…] → finalize).
 * Staff JWT only — RTO-operator role scoping is the deferred RBAC
 * concern (same Phase-1A posture as the picker/packer controllers).
 * The atomicity guards (gate 1: order-status short-circuit; gate 2:
 * existing-movements query, the two-gate Option A) are in the service.
 */
@ApiTags('warehouse-rto')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('warehouse/rto')
export class WarehouseRtoController {
  constructor(
    private readonly receipt: RtoReceiptService,
    private readonly inspection: RtoInspectionService,
    private readonly disposition: RtoDispositionService,
  ) {}

  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Receive an inbound RTO parcel by AWB: stamps shipment.rtoReceivedAt + drives the order to RTO_RECEIVED (saga). Idempotent',
  })
  receive(
    @Body() body: ReceiveRtoDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ReceiveRtoResult> {
    return this.receipt.receive(body.awbNumber, staff.id, ctx);
  }

  @Post('items/:shipmentItemId/inspect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Per-line RTO inspection: record condition + disposition + notes. Overwrites prior values (operator correction)',
  })
  inspect(
    @Param('shipmentItemId', new ParseUUIDPipe({ version: '7' }))
    shipmentItemId: string,
    @Body() body: InspectRtoItemDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<InspectRtoItemResult> {
    return this.inspection.inspect(
      shipmentItemId,
      {
        condition: body.condition,
        disposition: body.disposition,
        notes: body.notes ?? null,
      },
      staff.id,
      ctx,
    );
  }

  @Post('shipments/:shipmentId/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'WMS-8 finalize: atomic RETURN_RESTOCK movements (RESTOCK lines) + RTO_RECEIVED→RTO_RESTOCKED (saga). Two-gate idempotency on retry (order-status + existing-movements)',
  })
  finalize(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<FinalizeRtoResult> {
    return this.disposition.finalize(shipmentId, staff.id, ctx);
  }
}
