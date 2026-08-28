import { Module } from '@nestjs/common';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { AdminServiceabilityController } from './controllers/admin-serviceability.controller';
import { SellerServiceabilityController } from './controllers/seller-serviceability.controller';
import { OrderServiceabilityService } from './services/order-serviceability.service';
import { ServiceabilityCacheService } from './services/serviceability-cache.service';

/**
 * "Can we deliver there?", asked cheaply.
 *
 * Its OWN module rather than a service inside `courier-shared`, and the
 * reason is a cycle: `courier-delhivery` imports `courier-shared` for
 * credentials, so `courier-shared` cannot turn round and import the
 * Delhivery adapter. Nest reports that as a module of type `undefined`
 * and the app will not start.
 *
 * This is the R3 answer the codebase reaches for every time — extract
 * the thing that needs both sides into a module that depends on them,
 * rather than a `forwardRef` that leaves the cycle in place and hides
 * it. Direction is one-way: order and call-centre import this; it
 * imports the adapter; the adapter imports neither.
 */
@Module({
  imports: [CourierSharedModule, CourierShiprocketModule, RedisModule, CourierDelhiveryModule],
  controllers: [SellerServiceabilityController, AdminServiceabilityController],
  providers: [ServiceabilityCacheService, OrderServiceabilityService],
  exports: [OrderServiceabilityService],
})
export class CourierServiceabilityModule {}
