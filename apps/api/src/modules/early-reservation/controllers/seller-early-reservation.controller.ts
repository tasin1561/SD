import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type EarlyReservationReviewStatus, SellerUserRole } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerRoles } from '../../../common/decorators/seller-roles.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DecideReviewDto } from '../dto/early-reservation.dto';
import {
  EarlyReservationReviewService,
  type ReviewView,
} from '../services/early-reservation-review.service';

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
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.OPS)
@Controller('seller/early-reservation-reviews')
export class SellerEarlyReservationController {
  constructor(private readonly reviews: EarlyReservationReviewService) {}

  @Get()
  @SellerAuthAllowSuspended()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Orders whose call attempts ran out while stock was still held at placement, awaiting the seller\'s release-or-retry decision',
  })
  list(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Query('status') status?: EarlyReservationReviewStatus,
  ): Promise<readonly ReviewView[]> {
    return this.reviews.listForSeller(seller.id, status);
  }

  @Patch(':reviewId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Decide: RELEASE gives the stock back; REQUEST_MORE_ATTEMPTS keeps the hold. Rejects REVIEW_ALREADY_RESOLVED on a double submit',
  })
  decide(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('reviewId') reviewId: string,
    @Body() body: DecideReviewDto,
  ): Promise<ReviewView> {
    return this.reviews.decide(
      seller.id,
      reviewId,
      body.decision,
      seller.userId,
      body.note ?? null,
    );
  }
}
