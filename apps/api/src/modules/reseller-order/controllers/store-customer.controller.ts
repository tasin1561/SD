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
import { StoreCustomersService } from '../services/store-customers.service';
import { viewerFor } from '../services/store-orders.service';

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
 *
 * ASSOC-1 — an associate reads only the people THEY have sold to. The
 * narrowing is over the ORDERS (a store's customer row is one identity
 * however many of its people sold to them), and it is in the WHERE
 * clause, so a colleague's customer is a 404.
 */
@ApiTags('store-customers')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('customers.view')
@Controller('store/customers')
export class StoreCustomerController {
  constructor(
    private readonly customers: CustomerService,
    private readonly scoped: StoreCustomersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'This store’s customers' })
  list(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Query() query: ListCustomersQueryDto,
  ): Promise<{ items: CustomerView[]; total: number; page: number; pageSize: number }> {
    return this.scoped.list(user.storeId, viewerFor(user), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of this store’s customers' })
  get(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<CustomerView> {
    return this.scoped.get(user.storeId, viewerFor(user), id);
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
    //
    // ASSOC-1 — narrowed to the people this person has sold to FIRST, so
    // an associate cannot edit a colleague's customer through an id they
    // guessed. The 404 comes from the same read their own screen uses.
    await this.scoped.get(user.storeId, viewerFor(user), id);
    return this.customers.update(user.sellerId, id, body, { storeId: user.storeId });
  }
}
