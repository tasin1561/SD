import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/auth/require-permissions.decorator';
import { RequireSellerPermissions } from '../../../common/auth/require-seller-permissions.decorator';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentSeller } from '../../../common/decorators/current-seller.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { SellerJwtGuard } from '../../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../../common/guards/staff-jwt.guard';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller, AuthenticatedStoreUser } from '../../../common/types/request';
import { StoreOrdersService, viewerFor } from '../../reseller-order/services/store-orders.service';
import {
  CourierWhatsappHealthService,
  type CourierWhatsappHealth,
} from '../services/courier-whatsapp-health.service';
import {
  CourierWhatsappReadService,
  type CourierWhatsappView,
} from '../services/courier-whatsapp-read.service';
import {
  CourierWhatsappRequestService,
  type WhatsappRequestOutcome,
} from '../services/courier-whatsapp-request.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/** Staff: every order. */
@ApiTags('admin-orders')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('orders.view')
@Controller('admin/orders')
export class AdminCourierWhatsappController {
  constructor(
    private readonly read: CourierWhatsappReadService,
    private readonly request: CourierWhatsappRequestService,
  ) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer (read off its panel)' })
  get(@Param('id', uuid()) id: string): Promise<CourierWhatsappView> {
    return this.read.forOrder(id, { sellerId: null });
  }

  @Post(':id/courier-messages/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the portal worker to read the courier WhatsApp window again' })
  async refresh(@Param('id', uuid()) id: string): Promise<WhatsappRequestOutcome> {
    const view = await this.read.forOrder(id, { sellerId: null });
    if (view.shipmentId === null) return { queued: false, reason: 'NOT_DELHIVERY' };
    return this.request.request(view.shipmentId, { kind: 'viewer' });
  }
}

/** How the reader is doing: reads and failures today, backlog age. */
@ApiTags('admin-courier')
@ApiBearerAuth('staff-jwt')
@UseGuards(StaffJwtGuard)
@ThrottleKey('auth-user')
@RequirePermissions('courier.ops.view')
@Controller('admin/courier/whatsapp-health')
export class AdminCourierWhatsappHealthController {
  constructor(private readonly health: CourierWhatsappHealthService) {}

  @Get()
  @ApiOperation({ summary: 'Courier WhatsApp reader health' })
  get(): Promise<CourierWhatsappHealth> {
    return this.health.snapshot();
  }
}

/** Client (seller): its own orders; another seller's is a 404. */
@ApiTags('seller-orders')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('orders.view')
@Controller('seller/orders')
export class SellerCourierWhatsappController {
  constructor(private readonly read: CourierWhatsappReadService) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<CourierWhatsappView> {
    return this.read.forOrder(id, { sellerId: seller.id });
  }
}

/**
 * Member store and associate (one portal API). Ownership is decided by
 * the store's own order read — `StoreOrdersService.events` runs
 * `assertOwned(storeId, viewer, id)`, which already scopes an associate
 * to their own orders — so the rule is never re-implemented here.
 */
@ApiTags('store-orders')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('orders.view')
@Controller('store/orders')
export class StoreCourierWhatsappController {
  constructor(
    private readonly read: CourierWhatsappReadService,
    private readonly orders: StoreOrdersService,
  ) {}

  @Get(':id/courier-messages')
  @ApiOperation({ summary: 'WhatsApp messages the courier sent the customer' })
  async get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<CourierWhatsappView> {
    await this.orders.events(user.storeId, viewerFor(user), id); // 404 when not theirs
    return this.read.forProvenOrder(id);
  }
}
