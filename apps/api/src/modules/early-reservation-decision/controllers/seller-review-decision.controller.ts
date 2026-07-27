import { Body, Controller, HttpCode, HttpStatus, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SellerUserRole } from '@skydrop/db';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { SellerRoles } from '../../../common/decorators/seller-roles.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { DecideReviewDto } from '../../early-reservation/dto/early-reservation.dto';
import {
  EarlyReservationDecisionService,
  type DecisionResult,
} from '../services/early-reservation-decision.service';

/**
 * R5b — the seller answers "we could not reach your customer; keep trying
 * or release?". Served on the SAME path as the R5 list endpoint (which
 * lives in `early-reservation`) so the API shape did not change when the
 * decision gained an order transition; see the service doc for why the
 * two halves live in different modules.
 *
 * Deciding is an OPS-domain write (R0 RBAC policy), same allow-list as
 * the sibling controller.
 */
@ApiTags('seller-early-reservation-reviews')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@SellerRoles(SellerUserRole.OWNER, SellerUserRole.ADMIN, SellerUserRole.OPS)
@Controller('seller/early-reservation-reviews')
export class SellerReviewDecisionController {
  constructor(private readonly decisions: EarlyReservationDecisionService) {}

  @Patch(':reviewId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Decide: RELEASE gives the stock back and rejects the order (REJECTED_NDR); REQUEST_MORE_ATTEMPTS keeps the hold and puts the order back in the call queue. Rejects REVIEW_ALREADY_RESOLVED on a double submit.',
  })
  decide(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('reviewId') reviewId: string,
    @Body() body: DecideReviewDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DecisionResult> {
    return this.decisions.decide(
      seller.id,
      reviewId,
      body.decision,
      seller.userId,
      body.note ?? null,
      ctx,
    );
  }
}
