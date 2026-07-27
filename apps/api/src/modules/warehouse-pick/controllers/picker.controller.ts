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
import { PickQueueService, type PulledPick } from '../services/pick-queue.service';
import {
  PickExecutionService,
  type StartPickResult,
  type RecordPickItemResult,
  type CompletePickResult,
} from '../services/pick-execution.service';
import { RecordPickItemDto } from '../dto/record-pick-item.dto';

/**
 * Picker workflow (pull → start → recordItem(s) → complete). Staff JWT
 * only — picker role scoping is the deferred RBAC concern (same Phase-1A
 * posture as the call-agent / call-admin controllers). The
 * claim-ownership / state / lifecycle guards ARE enforced now, in the
 * services (commit 4: claim-on-pull; commit 6: PICK_NOT_OWNED /
 * PICK_NOT_CLAIMED / PICK_ALREADY_COMPLETED / SHIPMENT_NOT_PICKABLE /
 * ORDER_NOT_PICKABLE / PICK_NOT_IN_PROGRESS / PICK_INCOMPLETE).
 */
@ApiTags('warehouse-picker')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@Controller('warehouse/picks')
export class PickerController {
  constructor(
    private readonly queue: PickQueueService,
    private readonly execution: PickExecutionService,
  ) {}

  @Post('next')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull the next FIFO pick parcel (SKIP LOCKED). 200 with pick, or pick:null when QUEUE_EMPTY',
  })
  async next(
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<{ pick: PulledPick | null }> {
    const pick = await this.queue.pullNext(staff.id, ctx);
    return { pick };
  }

  @Post(':shipmentId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Start the pick: CONFIRMED→PENDING_PICK + M5 phase-2 allocation (WMS-3). Shortfall fail-routes to PENDING_MANUAL_PLACEMENT (WMS-4)',
  })
  start(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<StartPickResult> {
    return this.execution.start(shipmentId, staff.id, ctx);
  }

  @Post(':shipmentId/items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Record the bin+batch the picker pulled an item from (operational hint on shipment_items; authoritative allocation is the phase-2 reservation, INV-4)',
  })
  recordItem(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @Body() body: RecordPickItemDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<RecordPickItemResult> {
    return this.execution.recordItem(
      shipmentId,
      staff.id,
      {
        shipmentItemId: body.shipmentItemId,
        pickedBinId: body.pickedBinId,
        pickedBatchId: body.pickedBatchId,
        ...(body.scannedSerials === undefined ? {} : { scannedSerials: body.scannedSerials }),
      },
      ctx,
    );
  }

  @Post(':shipmentId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Finish the pick: every line recorded → PENDING_PICK → PICKED (WMS-9). Idempotent on already-PICKED+stamped',
  })
  complete(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CompletePickResult> {
    return this.execution.complete(shipmentId, staff.id, ctx);
  }
}
