import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CreateStoreApiKeyDto } from '../dto/store-order-query.dto';
import {
  StoreApiKeyService,
  type CreatedStoreApiKey,
  type StoreApiKeyView,
} from '../services/store-api-key.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 — this store's API keys. A key places and reads THIS store's
 * orders (`/store-api/v1/orders`) and nothing else.
 */
@ApiTags('store-api-keys')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('integrations.manage')
@Controller('store/api-keys')
export class StoreApiKeyController {
  constructor(private readonly keys: StoreApiKeyService) {}

  @Get()
  @ApiOperation({ summary: 'This store’s API keys (never the secret)' })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreApiKeyView[]> {
    return this.keys.list(user.storeId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a key — the secret is in this response only' })
  create(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CreateStoreApiKeyDto,
  ): Promise<CreatedStoreApiKey> {
    return this.keys.create(user, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a key' })
  async revoke(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<void> {
    await this.keys.revoke(user, id);
  }
}
