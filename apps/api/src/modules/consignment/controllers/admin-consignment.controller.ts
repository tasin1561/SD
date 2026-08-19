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
  CancelConsignmentDto,
  DispatchToIndiaDto,
  ListConsignmentsQueryDto,
  SetLabellingSiteDto,
} from '../dto/consignment.dto';
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
    private readonly cancels: ConsignmentCancelService,
    private readonly events: ConsignmentEventService,
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
