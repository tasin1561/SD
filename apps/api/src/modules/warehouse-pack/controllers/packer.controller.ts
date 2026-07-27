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
import { CompletePackDto } from '../dto/complete-pack.dto';

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
@Controller('warehouse/packs')
export class PackerController {
  constructor(
    private readonly queue: PackQueueService,
    private readonly pack: PackService,
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
}
