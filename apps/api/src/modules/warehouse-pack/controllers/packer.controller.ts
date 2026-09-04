import {
  Body,
  Controller,
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
import { PackQueueService, type PulledPack } from '../services/pack-queue.service';
import { PackService, type CompletePackResult } from '../services/pack.service';
import { CompletePackDto, ForceCompletePackDto } from '../dto/complete-pack.dto';
import {
  CancelPackBoxDto,
  ClosePackBoxDto,
  OpenPackBoxDto,
  ScanIntoPackBoxDto,
} from '../dto/pack-box.dto';
import { PackBoxService, type OpenBoxResult, type ScanResult } from '../services/pack-box.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Packer workflow (pull → complete). Staff JWT only — packer role
 * scoping is the deferred RBAC concern (same Phase-1A posture as the
 * picker/agent controllers). Pack is INTENTIONALLY claim-free (commit 1
 * schema): pullNext is informational (race-free for SIMULTANEOUS pulls
 * via SKIP LOCKED, race-resolved at complete via the atomic guard);
 * complete is the race-resolution point (409 PACK_NOT_AVAILABLE for the
 * loser, who pulls again).
 */
@ApiTags('warehouse-packer')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('warehouse.pack')
@Controller('warehouse/packs')
export class PackerController {
  constructor(
    private readonly queue: PackQueueService,
    private readonly pack: PackService,
    private readonly boxes: PackBoxService,
  ) {}

  @Post('next')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Pull the next FIFO pack-eligible parcel (PICKED + CREATED + pack_completed_at NULL), optionally restricted to one courier via ?courierCode=. 200 with pack, or pack:null when QUEUE_EMPTY',
  })
  async next(
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
    @Query('courierCode') courierCode?: string,
  ): Promise<{ pack: PulledPack | null }> {
    const pack = await this.queue.pullNext(staff.id, ctx, courierCode);
    return { pack };
  }

  @Post(':shipmentId/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Finish the pack: atomic stamp → PICKED→PACKED → post-commit auto-attach to DRAFT manifest (WMS-7). Idempotent on already-PACKED+stamped',
  })
  complete(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
    @Body() body?: CompletePackDto,
  ): Promise<CompletePackResult> {
    return this.pack.complete(shipmentId, staff.id, ctx, body?.scannedSerials);
  }

  /**
   * Pack a parcel WITHOUT scanning its contents.
   *
   * Its own endpoint and its own permission on purpose: a packer must
   * not be able to authorise skipping the check they are the ones
   * performing. A supervisor can — the label printer is broken, the
   * barcode is torn, the goods were shelved before labelling existed —
   * and it lands as a HIGH `warehouse_pack.completed_unverified` audit
   * row with their reason on it, so how often this happens is a
   * question with an answer.
   */
  @Post(':shipmentId/force-complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('warehouse.pick.supervise')
  @ApiOperation({
    summary:
      'Supervisor: finish a pack WITHOUT the box scan, with a written reason. Audited HIGH as a distinct action. For a torn barcode or goods that predate labelling — not for ordinary packing',
  })
  forceComplete(
    @Param('shipmentId', new ParseUUIDPipe({ version: '7' }))
    shipmentId: string,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
    @Body() body: ForceCompletePackDto,
  ): Promise<CompletePackResult> {
    return this.pack.complete(shipmentId, staff.id, ctx, body.scannedSerials, body.reason);
  }

  // ── The box ─────────────────────────────────────────────────────────
  // Scan the label to open, scan the products in, scan the label again
  // to close. Opening takes an exclusive claim on both the parcel and
  // the packer, so ten benches can run at once without two people
  // filling the same box.

  @Post('boxes/open')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Open a box by scanning the shipping label. Exclusive: one open box per parcel and one per packer. Re-scanning your own open box is idempotent.',
  })
  openBox(
    @Body() body: OpenPackBoxDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<OpenBoxResult> {
    return this.boxes.open(body.awbNumber, staff.id);
  }

  @Post('boxes/:packBoxId/scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Scan one product into the open box — a per-unit serial or a SKU barcode. Refuses a product that is not on the order, one too many, or a unit picked for a different parcel.',
  })
  scanIntoBox(
    @Param('packBoxId', new ParseUUIDPipe({ version: '7' })) packBoxId: string,
    @Body() body: ScanIntoPackBoxDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<ScanResult> {
    return this.boxes.scan(packBoxId, body.code, staff.id);
  }

  @Post('boxes/:packBoxId/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Close the box by scanning the same label again, then complete the pack. Contents are checked as a SET — a count alone would pass two of one item and none of another.',
  })
  async closeBox(
    @Param('packBoxId', new ParseUUIDPipe({ version: '7' })) packBoxId: string,
    @Body() body: ClosePackBoxDto,
    @CurrentStaff() staff: AuthenticatedStaff,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CompletePackResult> {
    const closed = await this.boxes.close(packBoxId, body.awbNumber, staff.id);
    // The box is the scan discipline; PackService.complete is still the
    // one place a parcel becomes PACKED — the stamp, the PICKED→PACKED
    // transition and the WMS-7 manifest attach all stay where they were.
    return this.pack.complete(closed.shipmentId, staff.id, ctx);
  }

  @Post('boxes/:packBoxId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Abandon an open box: scans discarded, serialized units returned to PICKED, parcel back in the queue. Returns NOTHING to inventory — packing never removed it (stock leaves once, at dispatch).',
  })
  cancelBox(
    @Param('packBoxId', new ParseUUIDPipe({ version: '7' })) packBoxId: string,
    @Body() body: CancelPackBoxDto,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<{ packBoxId: string; releasedScans: number }> {
    return this.boxes.cancel(packBoxId, body.reason, staff.id);
  }
}
