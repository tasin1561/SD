import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { TreasuryModule } from '../treasury/treasury.module';
import { AdminWalletTransferController } from './controllers/admin-wallet-transfer.controller';
import { StaffWalletTransferReadService } from './services/staff-wallet-transfer-read.service';
import { StaffWalletTransferService } from './services/staff-wallet-transfer.service';

/**
 * Staff debiting or crediting a seller's wallet, with the cash behind it
 * moving (STAFF_DEBIT / STAFF_CREDIT, TRE-8).
 *
 * A LEAF: nothing imports it and it exports nothing. It writes through the
 * sole wallet writer (WalletService, WAL-1/WAL-7) and posts cash only
 * through the attribution service and the bank ledger (TRE-1) — it has no
 * write path of its own.
 */
@Module({
  imports: [PrismaModule, AuthCommonModule, SellerWalletModule, TreasuryModule],
  controllers: [AdminWalletTransferController],
  providers: [StaffWalletTransferService, StaffWalletTransferReadService],
})
export class AdminWalletTransferModule {}
