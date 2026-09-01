import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminWalletImportController } from './controllers/admin-wallet-import.controller';
import { WalletImportService } from './services/wallet-import.service';

/**
 * What the courier actually charged, read off their wallet export.
 *
 * A LEAF module: it exports nothing and nothing imports it. It reads a
 * file and writes two columns on `shipments`, which the P&L already
 * knows how to read.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminWalletImportController],
  providers: [WalletImportService, StaffJwtGuard],
})
export class CourierWalletImportModule {}
