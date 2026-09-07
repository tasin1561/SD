import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { SellerStoreController } from './controllers/seller-store.controller';
import { SellerStoreService } from './services/seller-store.service';

/**
 * Shopfronts — a shared primitive, deliberately dependency-free.
 *
 * `order` needs it to file a sale, and `seller-auth` needs it to give a
 * new company its first store in the same transaction. It imports
 * neither, so wiring it into both closes no cycle — the R3 extraction,
 * rather than a `forwardRef` between order and auth.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [SellerStoreController],
  providers: [SellerStoreService, SellerJwtGuard],
  exports: [SellerStoreService],
})
export class SellerStoreModule {}
