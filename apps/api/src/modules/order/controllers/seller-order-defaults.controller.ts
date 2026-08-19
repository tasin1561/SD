import { Body, Controller, Get, HttpCode, HttpStatus, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { SellerAuthAllowSuspended } from '../../../common/decorators/seller-auth-allow-suspended.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { SetCustomerDeliveryFeeDto } from '../dto/customer-delivery-fee.dto';

const KEY = 'orders.default_customer_delivery_fee_inr';

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
}
