import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerRbacController } from './controllers/seller-rbac.controller';
import { SellerRbacService } from './services/seller-rbac.service';

/**
 * Per-company roles. A LEAF module — nothing imports it and it exports
 * nothing; the permission KEYS other modules declare live in
 * `common/auth/seller-permissions.ts`, not here.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [SellerRbacController],
  providers: [SellerRbacService],
})
export class SellerRbacModule {}
