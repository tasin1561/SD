import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SettingsModule } from '../settings/settings.module';
import { AdminPricingController } from './controllers/admin-pricing.controller';
import { MarginCalculationService } from './services/margin-calculation.service';
import { PricingEngineService } from './services/pricing-engine.service';

/**
 * Pricing — a flat per-seller delivery fee.
 *
 * `OrderService.create` calls `OrderChargesService.persistForOrderSystem`
 * post-commit; the admin preview endpoint exercises the same engine
 * standalone. Imports `SettingsModule` because the fee is resolved
 * through SET-1 — the seller's override beats the global default, and
 * that resolution is the whole engine now.
 *
 * `ZoneResolverService` is gone with the zone/slab pricing it served.
 * `MarginCalculationService` stays, but its courier-cost input is now
 * always null: the honest margin figure comes from the courier's own
 * invoice (the courier-ops margin report), not from a typed-in rate-card
 * cost.
 */
@Module({
  imports: [SettingsModule],
  controllers: [AdminPricingController],
  providers: [PricingEngineService, MarginCalculationService, StaffJwtGuard],
  exports: [PricingEngineService, MarginCalculationService],
})
export class PricingModule {}
