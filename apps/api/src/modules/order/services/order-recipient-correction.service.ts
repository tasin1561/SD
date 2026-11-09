import { Injectable } from '@nestjs/common';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { OrderService, type CallRecipientCorrection, type OrderView } from './order.service';

/**
 * The ONE cross-module door for "an agent corrects the customer's details
 * during a confirmation call" (2026-11-09).
 *
 * Exported beside `OrderReadService` / `OrderWriteService` because the
 * call-center module must not reach `OrderService` (not exported) and must
 * not write `orders` itself (ORD-3 spirit). It owns no logic: the route
 * check, ORD-5 validation, the event and the audit row all live in
 * `OrderService.correctRecipientOnCall`.
 */
@Injectable()
export class OrderRecipientCorrectionService {
  constructor(private readonly orders: OrderService) {}

  correctOnCall(
    orderId: string,
    patch: CallRecipientCorrection,
    call: { readonly assignmentId: string; readonly agentId: string },
    ctx: ClientContext,
  ): Promise<OrderView> {
    return this.orders.correctRecipientOnCall(orderId, patch, call, ctx);
  }
}
