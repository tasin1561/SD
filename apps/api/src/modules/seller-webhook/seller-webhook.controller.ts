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
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import {
  SellerWebhookService,
  type WebhookEndpointView,
  type WebhookEndpointWithSecret,
} from './services/seller-webhook.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';
import { WEBHOOK_EVENT_CATALOGUE } from '../seller-webhook-delivery/webhook-event-catalogue';

const uuid = (): ParseUUIDPipe => new ParseUUIDPipe({ version: '7' });

/**
 * Seller outbound webhook endpoint management.
 *
 * The CREATE / ROTATE responses include the secretKey in plaintext —
 * the only times we expose it. GET / LIST never include the secret
 * (anti-leak). FE-2: the seller UI shows the secret ONCE post-create
 * + rotate, then never again — copy-to-clipboard mandatory.
 */
@ApiTags('seller-webhooks')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('webhooks.manage')
@Controller('seller/webhook-endpoints')
export class SellerWebhookController {
  constructor(private readonly svc: SellerWebhookService) {}

  /**
   * The events a seller may subscribe to, with the words they pick them
   * by.
   *
   * The same `WEBHOOK_EVENT_CATALOGUE` the STORE's `/store/webhook-endpoints/events`
   * serves — imported, never restated. A second list is how the two
   * screens come to offer different things while both look correct,
   * and this one is already derived from an F2 switch and pinned
   * against it in both directions by `webhook-event-catalogue.spec.ts`.
   *
   * It is a fixed list with nothing seller-specific in it, so it needs
   * no scoping; `webhooks.manage` from the class is what makes it a
   * seller's to read at all.
   */
  @Get('events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'The event codes a webhook can subscribe to' })
  events(): ReadonlyArray<{ readonly code: string; readonly description: string }> {
    return WEBHOOK_EVENT_CATALOGUE;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the seller’s outbound webhook endpoints' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<WebhookEndpointView[]> {
    return this.svc.list(seller.id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create endpoint (auto-generates HMAC secret; only revealed in this response)',
  })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecret> {
    return this.svc.create(seller.id, body);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit endpoint URL / name / events / active-flag' })
  update(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
    @Body() body: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointView> {
    return this.svc.update(seller.id, id, body);
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the HMAC secret (24h grace window for the previous one)' })
  rotate(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<WebhookEndpointWithSecret> {
    return this.svc.rotateSecret(seller.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete the endpoint' })
  async remove(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<void> {
    await this.svc.softDelete(seller.id, id);
  }
}
