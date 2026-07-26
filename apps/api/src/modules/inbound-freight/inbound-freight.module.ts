import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SettingsModule } from '../settings/settings.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InboundFreightService } from './services/inbound-freight.service';
import { AdminInboundFreightController } from './controllers/admin-inbound-freight.controller';
import { SellerInboundFreightController } from './controllers/seller-inbound-freight.controller';

/**
 * R3 — BD→India inbound freight billing. A leaf consumer: it imports the
 * wallet writer + the settings resolver and exports the service only so a
 * future admin dashboard / reporting module can read it.
 */
@Module({
  imports: [AuthCommonModule, SettingsModule, SellerWalletModule],
  controllers: [AdminInboundFreightController, SellerInboundFreightController],
  providers: [InboundFreightService, StaffJwtGuard, SellerJwtGuard],
  exports: [InboundFreightService],
})
export class InboundFreightModule {}
