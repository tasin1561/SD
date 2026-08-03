import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EarlyReservationReviewStatus } from '@skydrop/db';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { EarlyReservationReviewService } from '../services/early-reservation-review.service';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';

/**
 * Held-stock reviews, across every seller.
 *
 * These exist because the call centre exhausted its attempts on an order
 * whose stock was claimed at placement — so the stock is held against an
 * order that may never happen, and only the seller can say whether to
 * keep holding it.
 *
 * READ-ONLY, and that is the design rather than an omission. The
 * decision belongs to the seller (R5); an unanswered review is resolved
 * by the TTL sweep rather than left to rot; and an admin who must
 * genuinely intervene has god mode, which records itself as the
 * invariant-breaking act it is. Putting a Release button here would make
 * "we released your stock" a routine, unaudited act.
 *
 * What an operator DOES get is visibility: which sellers are sitting on
 * holds, how old, and how many units are frozen — enough to make the
 * phone call that actually resolves it.
 */
@ApiTags('admin-early-reservation-reviews')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('holds.manage')
@Controller('admin/early-reservation-reviews')
export class AdminEarlyReservationController {
  constructor(private readonly reviews: EarlyReservationReviewService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Held-stock reviews across all sellers, oldest first — the longest-held stock is the most expensive. `sellerId` filters, it does not scope.',
  })
  list(
    @Query('status') status?: EarlyReservationReviewStatus,
    @Query('sellerId') sellerId?: string,
    @Query('limit') limit?: string,
  ): ReturnType<EarlyReservationReviewService['listForAdmin']> {
    return this.reviews.listForAdmin({
      ...(status === undefined ? {} : { status }),
      ...(sellerId === undefined ? {} : { sellerId }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
  }
}
