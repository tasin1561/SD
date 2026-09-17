import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import {
  ResellerStoreActionPolicyService,
  type ActionPolicyView,
} from '../services/reseller-store-action-policy.service';

/**
 * 2026-09-17 — a reseller store reading what its seller lets it do about
 * an order, and how: for each of the seven capabilities, OFF, ask seller
 * staff first, or directly.
 *
 * The store portal renders each action from this — hidden when OFF,
 * "ask the seller" when held, direct otherwise. That is COSMETIC (FE-2):
 * every action site still reads the policy itself and refuses by name.
 *
 * `orders.view`, the key every store role that sees an order holds: the
 * policy decides what a person looking at an order is offered, and a
 * separate key would leave someone with `orders.cancel` unable to learn
 * whether their cancel would go straight through.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/action-policy')
export class StoreActionPolicyController {
  constructor(private readonly policies: ResellerStoreActionPolicyService) {}

  @Get()
  @ApiOperation({ summary: 'What the seller lets this store do about its orders, and how' })
  get(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<ActionPolicyView> {
    return this.policies.forStore(user.storeId);
  }
}
