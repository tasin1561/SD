import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequireStorePermissions } from '../../../common/auth/require-store-permissions.decorator';
import { CurrentStoreUser } from '../../../common/decorators/current-store-user.decorator';
import { StoreJwtGuard } from '../../../common/guards/store-jwt.guard';
import { ThrottleKey } from '../../../common/throttler/throttle-key.decorator';
import type { AuthenticatedStoreUser } from '../../../common/types/request';
import { CreateWebhookEndpointDto } from '../../seller-webhook/dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from '../../seller-webhook/dto/update-webhook-endpoint.dto';
import {
  StoreWebhookService,
  type StoreWebhookView,
  type StoreWebhookWithSecret,
} from '../services/store-webhook.service';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * RS-5 — this store's outbound webhooks: its OWN orders' events, signed
 * with its own secret (shown on create and rotate only).
 */
@ApiTags('store-webhooks')
@ApiBearerAuth('store-jwt')
@UseGuards(StoreJwtGuard)
@ThrottleKey('auth-user')
@RequireStorePermissions('integrations.manage')
@Controller('store/webhook-endpoints')
export class StoreWebhookController {
  constructor(private readonly webhooks: StoreWebhookService) {}

  @Get()
  @ApiOperation({ summary: 'This store’s webhook endpoints (never the secret)' })
  list(@CurrentStoreUser() user: AuthenticatedStoreUser): Promise<StoreWebhookView[]> {
    return this.webhooks.list(user.storeId);
  }

  @Get('events')
  @ApiOperation({ summary: 'The event codes an endpoint may subscribe to' })
  events(): ReadonlyArray<{ readonly code: string; readonly description: string }> {
    return this.webhooks.events();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an endpoint — the signing secret is in this response only' })
  create(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Body() body: CreateWebhookEndpointDto,
  ): Promise<StoreWebhookWithSecret> {
    return this.webhooks.create(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change an endpoint’s URL, name, events or switch' })
  update(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
    @Body() body: UpdateWebhookEndpointDto,
  ): Promise<StoreWebhookView> {
    return this.webhooks.update(user, id, body);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the signing secret (the old one works for 24h)' })
  rotate(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<StoreWebhookWithSecret> {
    return this.webhooks.rotateSecret(user, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an endpoint' })
  async remove(
    @CurrentStoreUser() user: AuthenticatedStoreUser,
    @Param('id', uuid()) id: string,
  ): Promise<void> {
    await this.webhooks.softDelete(user, id);
  }
}
