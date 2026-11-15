import { Module } from '@nestjs/common';
import { CourierWhatsappHealthService } from './services/courier-whatsapp-health.service';
import { WhatsappBreakerStore } from './services/whatsapp-breaker.store';
import { CourierWhatsappRequestService } from './services/courier-whatsapp-request.service';

/**
 * Just the enqueue side (Prisma + Redis, both global). Kept apart from
 * `CourierWhatsappModule` so a low-level module such as tracking-events
 * can import it without dragging in the controllers and the store-order
 * graph (which would risk an import cycle).
 */
@Module({
  providers: [CourierWhatsappRequestService, WhatsappBreakerStore, CourierWhatsappHealthService],
  exports: [CourierWhatsappRequestService, WhatsappBreakerStore, CourierWhatsappHealthService],
})
export class CourierWhatsappQueueModule {}
