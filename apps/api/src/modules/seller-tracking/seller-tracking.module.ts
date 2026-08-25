import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerRestrictionModule } from '../seller-restriction/seller-restriction.module';
import { SellerTrackingController } from './controllers/seller-tracking.controller';
import { SellerTrackingService } from './services/seller-tracking.service';

/**
 * A LEAF: nothing imports it, it exports nothing. It reads the M10
 * tracking tables directly rather than going through the PUBLIC
 * projection, because the two answer different questions — the public
 * one is deliberately blind, this one is the seller's own data.
 */
@Module({
  imports: [AuthCommonModule, SellerRestrictionModule],
  controllers: [SellerTrackingController],
  providers: [SellerTrackingService],
})
export class SellerTrackingModule {}
