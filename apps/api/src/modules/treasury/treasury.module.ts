import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminTreasuryController } from './controllers/admin-treasury.controller';
import { BankLedgerService } from './services/bank-ledger.service';
import { BankTransferService } from './services/bank-transfer.service';
import { ExpenseCategoryService } from './services/expense-category.service';
import { InvestmentService } from './services/investment.service';
import { LiabilitiesService } from './services/liabilities.service';
import { PnlService } from './services/pnl.service';
import { TreasuryReadService } from './services/treasury-read.service';

/**
 * Our own money: which account holds what, and how much of it is
 * somebody else's.
 *
 * `BankLedgerService` is exported because the flows that already move
 * money — a courier settlement, a topup approval, a withdrawal — must
 * record the bank side in the SAME transaction as the business event. A
 * bank line that commits without its cause is how a statement stops
 * matching the story.
 */
@Module({
  imports: [PrismaModule, AuthCommonModule],
  controllers: [AdminTreasuryController],
  providers: [
    BankLedgerService,
    BankTransferService,
    TreasuryReadService,
    PnlService,
    ExpenseCategoryService,
    InvestmentService,
    LiabilitiesService,
  ],
  exports: [BankLedgerService],
})
export class TreasuryModule {}
