import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SetConfirmationCallsDto } from '../dto/confirmation-calls-setting.dto';
import { SetCustomerDeliveryFeeDto } from '../dto/customer-delivery-fee.dto';

const KEY = 'orders.default_customer_delivery_fee_inr';
const KEY_CALLS = 'ops.call_confirmation_required';
const KEY_TTL = 'ops.call_auto_confirm_ttl_hours';

export interface ConfirmationCallsView {
  readonly callsRequired: boolean;
  readonly ttlHours: number;
  /** true when this client (or an admin for them) has set their own; false = our default. */
  readonly isOwnValue: boolean;
}

export interface CustomerDeliveryFeeView {
  readonly amountInr: string;
  /** true when the seller has set their own; false when it is our default. */
  readonly isOwnValue: boolean;
}

/**
 * The seller's own default for one field on the order form.
 *
 * It goes through `SettingsResolverService` rather than a column on
 * `sellers` — SET-1: new seller-configurable behaviour uses the override
 * mechanism, so the clamp and the audit come for free and the settings
 * screen can already see it.
 */
@ApiTags('seller-order-defaults')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/order-defaults')
export class SellerOrderDefaultsController {
  constructor(private readonly settings: SettingsResolverService) {}

  @Get('customer-delivery-fee')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'The delivery fee pre-filled on a new order' })
  async get(@CurrentSeller() seller: AuthenticatedSeller): Promise<CustomerDeliveryFeeView> {
    const resolved = await this.settings.resolve(seller.id, KEY);
    return {
      amountInr: String(resolved.value ?? '0'),
      isOwnValue: resolved.source === 'SELLER_OVERRIDE',
    };
  }

  @Patch('customer-delivery-fee')
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set the delivery fee pre-filled on a new order',
    description:
      'Autofill only. It does not change what Skydrop charges you, and the figure stays ' +
      'editable on every order.',
  })
  async set(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SetCustomerDeliveryFeeDto,
  ): Promise<CustomerDeliveryFeeView> {
    await this.settings.setOverride(
      seller.id,
      KEY,
      { valueType: 'DECIMAL', value: String(body.amountInr) },
      { sellerActor: true },
    );
    return this.get(seller);
  }

  @Get('confirmation-calls')
  @SellerAuthAllowSuspended()
  @ApiOperation({ summary: 'Whether new orders are phoned automatically, and the no-call TTL' })
  async getConfirmationCalls(
    @CurrentSeller() seller: AuthenticatedSeller,
  ): Promise<ConfirmationCallsView> {
    const [calls, ttl] = await Promise.all([
      this.settings.resolve(seller.id, KEY_CALLS),
      this.settings.resolve(seller.id, KEY_TTL),
    ]);
    return {
      callsRequired: calls.value !== false,
      ttlHours: Number(ttl.value),
      isOwnValue: calls.source === 'SELLER_OVERRIDE' || ttl.source === 'SELLER_OVERRIDE',
    };
  }

  @Patch('confirmation-calls')
  @RequireSellerPermissions('orders.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Turn automatic confirmation calls on/off and set the auto-confirm TTL',
    description:
      'OFF means new orders wait in the awaiting-confirmation list; you (or an admin) send the ' +
      'ones that need a call, and the rest are confirmed without a call when the TTL runs out. ' +
      'A return on an unconfirmed order is charged to you as usual. Shares one setting with admin; last writer wins.',
  })
  async setConfirmationCalls(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: SetConfirmationCallsDto,
  ): Promise<ConfirmationCallsView> {
    await this.settings.setOverride(
      seller.id,
      KEY_CALLS,
      { valueType: 'BOOLEAN', value: body.callsRequired },
      { sellerActor: true },
    );
    if (body.ttlHours !== undefined) {
      await this.settings.setOverride(
        seller.id,
        KEY_TTL,
        { valueType: 'INT', value: body.ttlHours },
        { sellerActor: true },
      );
    }
    return this.getConfirmationCalls(seller);
  }
}
