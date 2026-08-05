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
import { CurrentStaff } from '../../../common/decorators/current-staff.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import {
  AttachEwaybillDto,
  CancelWithCourierDto,
  EditShipmentDto,
  FetchDocumentQueryDto,
  NdrActionDto,
  ShipmentInsightQueryDto,
} from '../dto/courier-ops.dto';
import {
  CourierShipmentInsightService,
  type ShipmentInsight,
} from '../services/courier-shipment-insight.service';
import {
  CourierShipmentActionService,
  type ActionOutcome,
  type NdrOutcome,
  type NdrReadiness,
} from '../services/courier-shipment-action.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/** Reads include the courier's real cost, which is commercially
 *  sensitive — hence FINANCE rather than every warehouse hand. */

/** Writes reach the physical world; the list is deliberately shorter. */

/**
 * Courier operations against a single shipment.
 *
 * The capabilities behind these endpoints were built in D1–D7 and until
 * now had no caller: pricing, timing, paperwork, address correction,
 * cancellation, e-way bills and NDR actions all existed as services
 * nothing imported. This is where an operator reaches them.
 *
 * Reads (`insight`, `document`, `ndr-readiness`, `ewaybill-requirement`)
 * are free and safe against production. Writes go through the adapter's
 * write guard, which is default-OFF — so on an unconfigured system they
 * refuse with DELHIVERY_LIVE_WRITES_DISABLED rather than doing anything.
 * That refusal is the correct behaviour, not a bug to route around.
 */
@ApiTags('admin-courier-ops')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.ops.view')
@Controller('admin/courier-ops/shipments/:shipmentId')
export class AdminCourierOpsController {
  constructor(
    private readonly insight: CourierShipmentInsightService,
    private readonly actions: CourierShipmentActionService,
  ) {}

  @Get('insight')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "The courier's own view: expected delivery time and what this parcel actually costs us. Parts degrade independently — a missing piece explains itself in `unavailable`.",
  })
  getInsight(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Query() query: ShipmentInsightQueryDto,
  ): Promise<ShipmentInsight> {
    return this.insight.insight(
      staff.id,
      shipmentId,
      query.mode === undefined ? {} : { mode: query.mode },
    );
  }

  @Get('document')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Proof of delivery, consignee signature, or a reverse-pickup QC image. Delhivery only serves documents it has not archived, so fetch while a dispute is live.',
  })
  getDocument(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Query() query: FetchDocumentQueryDto,
  ): ReturnType<CourierShipmentInsightService['document']> {
    return this.insight.document(staff.id, shipmentId, query.docType);
  }

  @Get('ewaybill-requirement')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Whether Indian law requires an e-way bill for this parcel (declared value above ₹50,000). Moving goods without one risks detention and a penalty.',
  })
  ewaybillRequirement(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
  ): ReturnType<CourierShipmentActionService['ewaybillRequirement']> {
    return this.actions.ewaybillRequirement(shipmentId);
  }

  @Get('ndr-readiness')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Whether a failed delivery can be re-attempted, decided locally from the courier NSL code and attempt count — so an ineligible request is explained rather than rejected by Delhivery.',
  })
  ndrReadiness(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Query() query: NdrActionDto,
  ): Promise<NdrReadiness> {
    return this.actions.ndrReadiness(shipmentId, query.action);
  }

  @Post('edit')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Correct the recipient details on a live consignment. Delhivery refuses edits on dispatched or terminal parcels.',
  })
  edit(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Body() body: EditShipmentDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    return this.actions.editDestination(staff.id, shipmentId, { ...body }, ctx);
  }

  @Post('cancel')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask the courier to stop carrying this parcel. A parcel already moving becomes a RETURN rather than vanishing; the order is moved by the resulting scans, not by this call.',
  })
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Body() body: CancelWithCourierDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    return this.actions.cancelWithCourier(staff.id, shipmentId, body.reason, ctx);
  }

  @Post('ewaybill')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attach the e-way bill number to a consignment.' })
  attachEwaybill(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Body() body: AttachEwaybillDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ActionOutcome> {
    return this.actions.attachEwaybill(
      staff.id,
      shipmentId,
      { invoiceNumber: body.invoiceNumber, ewaybillNumber: body.ewaybillNumber },
      ctx,
    );
  }

  @Post('ndr-action')
  @RequirePermissions('courier.ops.write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a re-attempt or reverse-pickup reschedule. Returns a UPL id, NOT an outcome — Delhivery decides asynchronously and the result is polled.',
  })
  ndrAction(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' })) shipmentId: string,
    @Body() body: NdrActionDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<NdrOutcome> {
    return this.actions.takeNdrAction(staff.id, shipmentId, body.action, ctx);
  }
}
