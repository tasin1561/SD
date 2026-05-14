import { Module } from '@nestjs/common';
import { SellerApiKeyController } from './seller-api-key.controller';
import { SellerApiKeyService } from './seller-api-key.service';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';

@Module({
  controllers: [SellerApiKeyController],
  providers: [SellerApiKeyService, SellerJwtGuard, ApiKeyGuard],
  exports: [ApiKeyGuard],
})
export class SellerApiKeyModule {}
