import {
  Body,
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
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { CurrentSeller } from '../../common/decorators/current-seller.decorator';
import { ClientInfo, type ClientInfoPayload } from '../../common/decorators/client-info.decorator';
import { ThrottleKey } from '../../common/throttler/throttle-key.decorator';
import type { AuthenticatedSeller } from '../../common/types/request';
import { ApiKeyListItemDto, CreateApiKeyDto, CreatedApiKeyDto } from './dto/create.dto';
import { SellerApiKeyService } from './seller-api-key.service';
import { RequireSellerPermissions } from '../../common/auth/require-seller-permissions.decorator';

@ApiTags('seller-api-keys')
@ApiBearerAuth('seller-jwt')
@UseGuards(SellerJwtGuard)
@ThrottleKey('auth-user')
@RequireSellerPermissions('api_keys.manage')
@Controller('seller/api-keys')
export class SellerApiKeyController {
  constructor(private readonly svc: SellerApiKeyService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create an API key. Plaintext is returned ONCE in the response and cannot be recovered later.',
  })
  create(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Body() body: CreateApiKeyDto,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<CreatedApiKeyDto> {
    return this.svc.create(seller.id, body, ctx);
  }

  @Get()
  @ApiOperation({
    summary:
      'List the seller’s API keys. Returns prefix + metadata only; never the hash or plaintext.',
  })
  list(@CurrentSeller() seller: AuthenticatedSeller): Promise<ApiKeyListItemDto[]> {
    return this.svc.list(seller.id);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key — takes effect on the next request' })
  async revoke(
    @CurrentSeller() seller: AuthenticatedSeller,
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @ClientInfo() ctx: ClientInfoPayload,
  ): Promise<void> {
    await this.svc.revoke(seller.id, id, ctx);
  }
}
