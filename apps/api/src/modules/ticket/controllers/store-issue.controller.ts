import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CreateStoreIssueDto } from '../dto/store-issue.dto';
import { StoreIssueService } from '../services/store-issue.service';
import type { StoreTicketView } from '../services/ticket.service';

/**
 * 2026-09-16 — a reseller store raising something with SKYDROP.
 *
 * Its own controller rather than a handler on `StoreTicketController`,
 * for two reasons: that controller's gate list is pinned exactly by
 * `store-permission-surface.spec.ts`, and more importantly the two are
 * different acts. A dispute argues with the SELLER and is settled between
 * their wallets; this tells US we got something wrong.
 *
 * Reading it back, replying and its timeline all use the store's existing
 * ticket surface — `TicketService`'s store-facing reads admit both kinds.
 */
@ApiTags('store-tickets')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('tickets.manage')
@Controller('store/issues')
export class StoreIssueController {
  constructor(private readonly issues: StoreIssueService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Raise something with Skydrop about one of this store’s orders — damaged, lost, or stuck with us. The seller is not told.',
  })
  create(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CreateStoreIssueDto,
  ): Promise<StoreTicketView> {
    return this.issues.raise({
      storeId: user.storeId,
      storeUserId: user.id,
      orderId: body.orderId,
      subject: body.subject,
      description: body.description ?? null,
    });
  }
}
