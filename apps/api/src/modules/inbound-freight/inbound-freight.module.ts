import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SettingsModule } from '../settings/settings.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { CatalogReadModule } from '../catalog-read/catalog-read.module';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { InboundFreightService } from './services/inbound-freight.service';
import { InboundFreightAmortisationService } from './services/inbound-freight-amortisation.service';
import { AdminInboundFreightController } from './controllers/admin-inbound-freight.controller';
import { SellerInboundFreightController } from './controllers/seller-inbound-freight.controller';

/**
 * R3 — BD→India inbound freight billing. A leaf consumer: it imports the
 * wallet writer + the settings resolver and exports the service only so a
 * future admin dashboard / reporting module can read it.
 */
@Module({
  imports: [AuthCommonModule, SettingsModule, SellerWalletModule, CatalogReadModule],
  controllers: [AdminInboundFreightController, SellerInboundFreightController],
  providers: [
    InboundFreightService,
    InboundFreightAmortisationService,
    StaffJwtGuard,
    SellerJwtGuard,
  ],
  exports: [InboundFreightService, InboundFreightAmortisationService],
})
export class InboundFreightModule {}
