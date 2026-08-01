import {
  Body,
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
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { RtoReceiptService, type ReceiveRtoResult } from '../services/rto-receipt.service';
import {
  RtoInspectionService,
  type InspectRtoItemResult,
} from '../services/rto-inspection.service';
import { RtoDispositionService, type FinalizeRtoResult } from '../services/rto-disposition.service';
import { RtoReadService, type RtoShipmentDetail } from '../services/rto-read.service';
import {
  RtoPutawayService,
  type RtoPutawayPending,
  type RtoPutawayResult,
} from '../services/rto-putaway.service';
import { InspectRtoItemDto, ReceiveRtoDto, RtoPutawayDto } from '../dto/warehouse-rto.dto';

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
    private readonly read: RtoReadService,
    private readonly putaway: RtoPutawayService,
  ) {}

  @Get('shipments/:shipmentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Load a shipment for RTO inspection — header (status, AWB, rtoReceivedAt) + per-line shipment_items with their current inspection (rtoCondition / rtoDisposition / notes)',
  })
  loadShipment(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
  ): Promise<RtoShipmentDetail> {
    return this.read.loadShipment(shipmentId);
  }

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
    return this.receipt.receive(body.awbNumber, staff.id, ctx, body.warehouseId);
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

  @Get('shipments/:shipmentId/putaway')
  @ApiOperation({
    summary:
      'What is sitting in hold for this parcel, each with a suggested shelf (the bin it was picked from, else where this SKU currently lives here)',
  })
  listPutaway(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
  ): Promise<RtoPutawayPending[]> {
    return this.putaway.listPending(shipmentId);
  }

  @Post('shipments/:shipmentId/putaway')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Shelve returned goods: hold bin → a real bin, as a paired transfer. Only now do the units become sellable (INV-3 excludes hold bins)',
  })
  doPutaway(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: RtoPutawayDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RtoPutawayResult> {
    return this.putaway.putaway(shipmentId, body.lines, staff.id, ctx);
  }
}
