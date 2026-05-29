import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminPricingController } from './controllers/admin-pricing.controller';
import { PricingEngineService } from './services/pricing-engine.service';
import { ZoneResolverService } from './services/zone-resolver.service';

/**
 * Module 15 — Pricing Engine. Phase 1A is CALCULATE-ONLY (no
 * persistence into OrderCharge; no order-create integration). The
 * engine is reusable and the admin preview endpoint exercises it.
 *
 * The M6 OrderService.create integration is a fast-follow: call
 * `PricingEngineService.compute()` after the order row is created
 * + persist the breakdown into `order_charges` (one row per line
 * + a separate GST row). Append to the same `prisma.$transaction`
 * the create runs in.
 */
@Module({
  controllers: [AdminPricingController],
  providers: [PricingEngineService, ZoneResolverService, StaffJwtGuard],
  exports: [PricingEngineService, ZoneResolverService],
})
export class PricingModule {}
