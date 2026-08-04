import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type EarlyReservationReviewStatus } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import {
  EarlyReservationReviewService,
  type ReviewView,
} from '../services/early-reservation-review.service';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';

/**
 * R5 — the seller dashboard surface the founder described: "it will go to
 * the seller dashboard with all the details and then he will manually
 * decide if he wants to unbook or wants to have some more call attempts".
 *
 * Deciding is an OPS-domain write (class-level allow-list); the list read
 * stays open to every company role per the R0 RBAC policy.
 */
@ApiTags('seller-early-reservation-reviews')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('holds.manage')
@Controller('seller/early-reservation-reviews')
export class SellerEarlyReservationController {
  constructor(private readonly reviews: EarlyReservationReviewService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Orders whose call attempts ran out while stock was still held at placement, awaiting the seller's release-or-retry decision",
  })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('status') status?: EarlyReservationReviewStatus,
  ): Promise<readonly ReviewView[]> {
    return this.reviews.listForSeller(seller.id, status);
  }

  // R5b — the DECIDE endpoint moved to `early-reservation-decision`.
  // Applying a decision has to move the ORDER too, and this module cannot
  // import `order` (order already imports this one — a cycle). The leaf
  // module composes both and serves PATCH on this same path, so the API
  // shape is unchanged for callers.
}
