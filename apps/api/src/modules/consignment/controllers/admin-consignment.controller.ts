import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import type { AuthenticatedStaff } from '../../../common/types/request';
import { ConsignmentEventService } from '../../consignment-core/services/consignment-event.service';
import {
  ConsignmentFreightModeService,
  type ResolvedFreightMode,
} from '../../consignment-core/services/consignment-freight-mode.service';
import {
  ApproveLabelReprintDto,
  CancelConsignmentDto,
  DispatchToIndiaDto,
  ListConsignmentsQueryDto,
  RejectLabelReprintDto,
  ReprintLabelsDto,
  SetLabellingSiteDto,
} from '../dto/consignment.dto';
import { SetConsignmentFreightModeDto } from '../../inbound-freight/dto/inbound-freight.dto';
import {
  LabelReprintRequestService,
  type LabelReprintRequestView,
} from '../services/label-reprint-request.service';
import {
  ConsignmentCancelService,
  type CancelResult,
} from '../services/consignment-cancel.service';
import {
  ConsignmentDispatchService,
  type DispatchResult,
} from '../services/consignment-dispatch.service';
import { ConsignmentLabelService, type LabelSheet } from '../services/consignment-label.service';
import { ConsignmentService, type ConsignmentView } from '../services/consignment.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * The consignment panel — every step of the journey driven from one place.
 *
 * The counting itself is NOT here: each leg is an ordinary goods receipt
 * and uses the receiving station (`/admin/goods-receipts/...`) unchanged.
 * What lives here is what the receiving station has no opinion about —
 * where the labels are printed, when the goods leave Bangladesh, and
 * whether the whole thing is called off.
 */
@ApiTags('admin-consignments')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('inventory.view')
@Controller('admin/consignments')
export class AdminConsignmentController {
  constructor(
    private readonly svc: ConsignmentService,
    private readonly dispatch: ConsignmentDispatchService,
    private readonly labels: ConsignmentLabelService,
    private readonly reprints: LabelReprintRequestService,
    private readonly cancels: ConsignmentCancelService,
    private readonly events: ConsignmentEventService,
    private readonly freightMode: ConsignmentFreightModeService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List consignments (filter by seller, route, status)' })
  list(
    @Query() query: ListConsignmentsQueryDto,
  ): Promise<{ items: ConsignmentView[]; total: number; page: number; pageSize: number }> {
    return this.svc.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One consignment, with every leg and count' })
  get(@Param('id', uuid()) id: string): Promise<ConsignmentView> {
    return this.svc.requireById(id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'The full timeline, including anything hidden from the seller' })
  timeline(
    @Param('id', uuid()) id: string,
  ): Promise<
    Array<{ id: string; type: string; description: string | null; createdAt: Date; data: unknown }>
  > {
    return this.events.listForConsignment(id);
  }

  @Get(':id/freight-mode')
  @ApiOperation({
    summary: "How this consignment's freight is paid for, and whose decision that is",
    description:
      "The three-level chain: this consignment's own pin, else the seller override of " +
      '`wallet.inbound_freight_mode`, else the global default. `locked` is true once a bill ' +
      'exists — from then the mode is what the bill was raised on and cannot be changed.',
  })
  freightModeFor(@Param('id', uuid()) id: string): Promise<ResolvedFreightMode> {
    return this.freightMode.resolveForConsignment(id);
  }

  @Patch(':id/freight-mode')
  @RequirePermissions('money.freight.manage')
  @ApiOperation({
    summary: "Pin how THIS consignment's freight is paid for — set at BD receiving",
    description:
      'PAY_ADVANCE bills at the Bangladesh intake, before the goods fly; PAY_NOW and ' +
      'PAY_LATER both defer to the India arrival. Send no mode to clear the pin and fall ' +
      "through to the seller's terms again. Refused once a bill exists (FREIGHT_MODE_LOCKED).",
  })
  setFreightMode(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: SetConsignmentFreightModeDto,
  ): Promise<ResolvedFreightMode> {
    return this.freightMode.setOverride(staff.id, id, body.mode ?? null);
  }

  @Patch(':id/labelling-site')
  @RequirePermissions('inventory.goods_receipts.manage')
  @ApiOperation({
    summary: 'Choose where this consignment is labelled — one station only',
    description:
      'Free to change until the first label is printed, then LABELLING_SITE_LOCKED. ' +
      'BD is refused for a consignment that never passes through Bangladesh.',
  })
  setLabellingSite(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: SetLabellingSiteDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<ConsignmentView> {
    return this.svc.setLabellingSite(staff.id, id, body.site, ctx);
  }

  @Get(':id/labels')
  @ApiOperation({
    summary: 'What is waiting to be labelled, without printing anything',
  })
  previewLabels(@Param('id', uuid()) id: string): Promise<{
    site: string;
    locked: boolean;
    strictUnits: number;
    strictSkus: number;
  }> {
    return this.labels.preview(id);
  }

  @Post(':id/labels/print')
  @RequirePermissions('inventory.goods_receipts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The label sheet for this consignment; stamps the print and locks the station',
  })
  printLabels(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<LabelSheet> {
    return this.labels.print(staff.id, id, ctx);
  }

  /**
   * The damaged or lost sticker — LBL-5b, two people.
   *
   * A serial names ONE physical unit, so a second copy is how two boxes
   * come to claim the same one. Asking is the labeller's act (the
   * permission that prints the sheet); deciding takes
   * `warehouse.labels.reprint` AND not being the person who asked;
   * printing is the asker's, once. The service enforces the last two —
   * a permission cannot say "not you".
   */
  @Post(':id/labels/reprint-requests')
  @RequirePermissions('inventory.goods_receipts.manage')
  @ApiOperation({
    summary:
      'Ask for NAMED units’ labels to be reprinted, with a reason. Prints nothing — somebody else holding warehouse.labels.reprint must approve it first',
  })
  requestReprint(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: ReprintLabelsDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<LabelReprintRequestView> {
    return this.reprints.request(staff.id, id, body.serials, body.reason, ctx);
  }

  @Get(':id/labels/reprint-requests')
  @ApiOperation({ summary: 'This consignment’s label reprint requests, newest first' })
  listReprintRequests(@Param('id', uuid()) id: string): Promise<LabelReprintRequestView[]> {
    return this.reprints.list(id);
  }

  @Post('labels/reprint-requests/:requestId/approve')
  @RequirePermissions('warehouse.labels.reprint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Approve a reprint somebody ELSE asked for. Good for 24 hours, and only the person who asked can print it. Audited HIGH',
  })
  approveReprint(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('requestId', uuid()) requestId: string,
    @Body() body: ApproveLabelReprintDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<LabelReprintRequestView> {
    return this.reprints.approve(staff.id, requestId, body.note, ctx);
  }

  @Post('labels/reprint-requests/:requestId/reject')
  @RequirePermissions('warehouse.labels.reprint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a reprint somebody else asked for, saying why' })
  rejectReprint(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('requestId', uuid()) requestId: string,
    @Body() body: RejectLabelReprintDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<LabelReprintRequestView> {
    return this.reprints.reject(staff.id, requestId, body.note, ctx);
  }

  @Post('labels/reprint-requests/:requestId/print')
  @RequirePermissions('inventory.goods_receipts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'The sheet for an APPROVED reprint request — once, by the person who asked. Recorded on each unit’s own ledger and audited HIGH',
  })
  printReprint(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('requestId', uuid()) requestId: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<LabelSheet> {
    return this.reprints.print(staff.id, requestId, ctx);
  }

  @Post(':id/dispatch')
  // Moving stock between two warehouses is what this does, whatever the
  // consignment panel calls it — so it takes the transfer permission
  // rather than the receipt one.
  @RequirePermissions('inventory.transfers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send counted Bangladesh stock on to India',
    description:
      'Creates the India leg, moves the stock into the destination TRANSIT bin (non-pickable, ' +
      'so it is sellable from nowhere until it lands) and carries the batch across as a child. ' +
      'May be called more than once — a large intake often flies in several shipments.',
  })
  dispatchToIndia(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: DispatchToIndiaDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DispatchResult> {
    return this.dispatch.dispatchToIndia(staff.id, id, body, ctx);
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.goods_receipts.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Abandon a consignment — the goods go back to the seller',
    description:
      'Only before it leaves Bangladesh. Stock already booked in leaves as an ' +
      'ADJUSTMENT_DECREASE carrying RETURNED_TO_SELLER, which is deliberately not a write-off.',
  })
  cancel(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', uuid()) id: string,
    @Body() body: CancelConsignmentDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CancelResult> {
    return this.cancels.cancel({ staffId: staff.id }, id, body.reason, ctx);
  }
}
