import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import {
  ClientInfo,
  type ClientInfoPayload,
} from '../../../common/decorators/client-info.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { DecideReviewDto } from '../../early-reservation/dto/early-reservation.dto';
import type { ReviewView } from '../../early-reservation/services/early-reservation-review.service';
import { StoreReviewDecisionService } from '../services/store-review-decision.service';
import type { DecisionResult } from '../services/early-reservation-decision.service';

/**
 * 2026-09-16 — a reseller store answering the call-cap question on its
 * own order: keep trying, or give the stock back.
 *
 * The store is the only party who can ring the customer on a reseller
 * order, so it is the one that knows. Whether it MAY is the seller's
 * policy for the store; the service refuses by name when it is theirs.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.actions')
@Controller('store/call-reviews')
export class StoreReviewDecisionController {
  constructor(private readonly reviews: StoreReviewDecisionService) {}

  @Get()
  @ApiOperation({ summary: 'Orders of this store waiting on a keep-trying-or-release answer' })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<readonly ReviewView[]> {
    return this.reviews.listOpen(user.storeId);
  }

  @Patch(':reviewId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'RELEASE gives the stock back and rejects the order; REQUEST_MORE_ATTEMPTS keeps the hold and puts it back in the call queue.',
  })
  decide(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('reviewId') reviewId: string,
    @Body() body: DecideReviewDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<DecisionResult> {
    return this.reviews.decide({
      storeId: user.storeId,
      storeUserId: user.id,
      reviewId,
      decision: body.decision,
      note: body.note ?? null,
      ctx: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: null },
    });
  }
}
