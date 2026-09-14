import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { ListCustomersQueryDto } from '../../order/dto/customer.dto';
import { CustomerService, type CustomerView } from '../../order/services/customer.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 (ORD-7 generalised) — the people THIS store has sold to. A store's
 * customer is its own identity: the seller behind the store never sees
 * them, and another store never does either. Read-only.
 */
@ApiTags('store-customers')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('customers.view')
@Controller('store/customers')
export class StoreCustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  @ApiOperation({ summary: 'This store’s customers' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() query: ListCustomersQueryDto,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    return this.customers.listForStore(user.storeId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of this store’s customers' })
  get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<CustomerView> {
    return this.customers.getForStore(user.storeId, id);
  }
}
