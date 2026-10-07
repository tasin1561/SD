import { Module } from '@nestjs/common';
import { ImpersonationRuntimeModule } from '../../common/impersonation/impersonation-runtime.module';
import {
  SellerImpersonationExchangeController,
  StoreImpersonationExchangeController,
} from './impersonation-exchange.controller';
import { ImpersonationExchangeService } from './impersonation-exchange.service';

/**
 * The arrival door of a support session, kept apart from
 * `ImpersonationModule` (which opens sessions, verifies the OTP and
 * reviews them) because the two have different callers: that one is
 * reached by the admin console, this one by a seller's or a store's own
 * browser, at an origin the admin console cannot set a cookie for.
 *
 * It takes `ImpersonationModule` by way of the runtime module, which
 * re-exports it, so there is one statement of how the impersonation
 * pieces fit together rather than two.
 *
 * A LEAF — nothing imports it.
 */
@Module({
  imports: [ImpersonationRuntimeModule],
  controllers: [SellerImpersonationExchangeController, StoreImpersonationExchangeController],
  providers: [ImpersonationExchangeService],
})
export class ImpersonationExchangeModule {}
