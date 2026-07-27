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
@Controller('seller/webhook-endpoints')
export class SellerWebhookController {
  constructor(private readonly svc: SellerWebhookService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the seller’s outbound webhook endpoints' })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<WebhookEndpointView[]> {
    return this.svc.list(seller.id);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one endpoint' })
  get(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', uuid()) id: string,
  ): Promise<WebhookEndpointView> {
    return this.svc.getOwned(seller.id, id);
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
