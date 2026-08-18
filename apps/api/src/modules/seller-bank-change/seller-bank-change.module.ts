import { Module } from '@nestjs/common';

import { AuthCommonModule } from '../auth-common/auth-common.module';
import { AdminBankChangeController } from './controllers/admin-bank-change.controller';
import { BankChangeService } from './services/bank-change.service';

/**
 * A LEAF module: nothing imports it and it exports nothing. The seller
 * side of this flow lives in seller-profile (the PATCH that creates a
 * request); this is only the deciding half.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminBankChangeController],
  providers: [BankChangeService],
})
export class SellerBankChangeModule {}
