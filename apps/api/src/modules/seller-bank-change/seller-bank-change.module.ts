import { Module } from '@nestjs/common';

import { AuthCommonModule } from '../auth-common/auth-common.module';
import { BankAccountCipherService } from '../seller-profile/services/bank-account-cipher.service';
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
  // The cipher is provided here rather than imported from seller-profile:
  // it is a pure function of env keys with no state, and importing that
  // module for one stateless helper would drag its whole surface across.
  providers: [BankChangeService, BankAccountCipherService],
})
export class SellerBankChangeModule {}
