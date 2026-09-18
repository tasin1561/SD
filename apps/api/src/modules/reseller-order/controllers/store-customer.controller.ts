import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { ListCustomersQueryDto, UpdateCustomerDto } from '../../order/dto/customer.dto';
import { CustomerService, type CustomerView } from '../../order/services/customer.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 (ORD-7 generalised) — the people THIS store has sold to.
 *
 * A store's customer is its own identity: another store never sees them.
 * The SELLER behind the store does (2026-09-16 — they ring that customer
 * about a failed delivery) and may now change the record too
 * (2026-09-18); the store is told when they do, and vice versa.
 *
 * The PHONE is not editable here or anywhere: it is what tells one
 * customer from another (ORD-7).
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

  @Patch(':id')
  @RequireStorePermissions('customers.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit one of this store’s customers (the phone is immutable, ORD-7)' })
  async update(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Body() body: UpdateCustomerDto,
  ): Promise<CustomerView> {
    // Scoped in the WHERE clause by the token's store, never fetched and
    // then compared: a miss is a 404 that says nothing about whether the
    // row exists (RS-2).
    return this.customers.update(user.sellerId, id, body, { storeId: user.storeId });
  }
}
