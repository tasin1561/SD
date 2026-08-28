import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SellerCreditService } from './services/seller-credit.service';

/**
 * How far into the red a seller may go.
 *
 * Its own module rather than a service inside `seller-wallet`, because
 * that one is a dependency-free R3 primitive (the sole writer of wallet
 * entries) and this needs the settings resolver. Adding a dependency
 * there to save a file would cost the property that makes it safe to
 * import from anywhere.
 */
@Module({
  imports: [SettingsModule],
  providers: [SellerCreditService],
  exports: [SellerCreditService],
})
export class SellerCreditModule {}
