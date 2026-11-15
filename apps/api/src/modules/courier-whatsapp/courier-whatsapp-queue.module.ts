import { Module } from '@nestjs/common';
import { CourierWhatsappRequestService } from './services/courier-whatsapp-request.service';

/**
 * Just the enqueue side (Prisma + Redis, both global). Kept apart from
 * `CourierWhatsappModule` so a low-level module such as tracking-events
 * can import it without dragging in the controllers and the store-order
 * graph (which would risk an import cycle).
 */
@Module({
  providers: [CourierWhatsappRequestService],
  exports: [CourierWhatsappRequestService],
})
export class CourierWhatsappQueueModule {}
