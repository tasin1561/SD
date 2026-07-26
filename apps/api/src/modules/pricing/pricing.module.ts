import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminPricingController } from './controllers/admin-pricing.controller';
import { MarginCalculationService } from './services/margin-calculation.service';
import { PricingEngineService } from './services/pricing-engine.service';
import { ZoneResolverService } from './services/zone-resolver.service';

/**
 * Module 15 — Pricing Engine. `OrderService.create` already calls
 * `OrderChargesService.persistForOrderSystem` post-commit (the M6
 * fast-follow this doc comment used to call "not yet done" — it has
 * landed); the admin preview endpoint exercises the same engine
 * standalone. R1c added `MarginCalculationService` — wires the
 * previously-unused `RateCardItem.costToSkydropInr` into a real
 * margin figure, snapshotted into `computationContext`, admin/internal
 * only (never surfaced to sellers, never touches the wallet).
 */
@Module({
  controllers: [AdminPricingController],
  providers: [PricingEngineService, ZoneResolverService, MarginCalculationService, StaffJwtGuard],
  exports: [PricingEngineService, ZoneResolverService, MarginCalculationService],
})
export class PricingModule {}
