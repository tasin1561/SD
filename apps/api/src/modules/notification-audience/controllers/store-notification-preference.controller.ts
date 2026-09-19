import { Body, ConflictException, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { SetStoreNotificationPreferenceDto } from '../dto/notification.dto';
import {
  StoreCategoryNotMutableError,
  StoreNotificationPreferenceService,
  type StoreCategoryView,
} from '../services/store-notification-preference.service';

/**
 * What the STORE — everybody at it — is told about (2026-09-19).
 *
 * The first of the two layers (owner decision (c)); the second is each
 * person's own per-topic choice on `StoreNotificationController`, which
 * is self-service. This one is an ADMINISTRATIVE act: switching a
 * category off here stops it reaching colleagues too, so it is gated.
 *
 * ── WHY `store.profile.*` AND NOT A NEW KEY ──────────────────────────
 * A new permission has to be GRANTED, and a key added today reaches no
 * role that already exists — so a brand-new `notifications.manage` would
 * have rendered this section for nobody until somebody backfilled every
 * store's roles. `store.profile.view` is held by all four starting roles
 * and `store.profile.manage` by the owner and admin, which is exactly
 * the audience "decide what this store is told" should have: the people
 * who already decide what the store IS.
 */
@ApiTags('store-notifications')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@Controller('store/notification-preferences')
export class StoreNotificationPreferenceController {
  constructor(private readonly prefs: StoreNotificationPreferenceService) {}

  @Get()
  @RequireStorePermissions('store.profile.view')
  @ApiOperation({
    summary:
      'Every category, what this store has said about it, and which of its topics can never be silenced',
  })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<readonly StoreCategoryView[]> {
    return this.prefs.list(user.storeId);
  }

  @Put()
  @RequireStorePermissions('store.profile.manage')
  @ApiOperation({
    summary:
      'Set what the whole store is told about one category. Applies to everybody here, not only you.',
  })
  async set(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: SetStoreNotificationPreferenceDto,
  ): Promise<StoreCategoryView> {
    try {
      return await this.prefs.set({
        storeId: user.storeId,
        category: body.category,
        emailEnabled: body.emailEnabled,
        inAppEnabled: body.inAppEnabled,
        byStoreUserId: user.id,
      });
    } catch (err) {
      // A category holding nothing but messages Skydrop never silences.
      // Surfaced as the server's own verdict so the screen can show it
      // verbatim (FE-2) rather than pre-empting the rule.
      if (err instanceof StoreCategoryNotMutableError) {
        throw new ConflictException({
          code: 'STORE_CATEGORY_NOT_MUTABLE',
          message: err.message,
        });
      }
      throw err;
    }
  }
}
