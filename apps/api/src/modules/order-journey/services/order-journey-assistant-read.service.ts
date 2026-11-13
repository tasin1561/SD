import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderJourneyService } from './order-journey.service';

export interface AssistantFailedAttempt {
  readonly attemptNumber: number;
  readonly at: string;
  /** The courier's reason, in their words. */
  readonly reason: string | null;
  /** Their own code and what it means in plain English, when we know. */
  readonly courierCode: string | null;
  readonly meaning: string | null;
  /** Whether the courier accepts another attempt on that code. */
  readonly canAskForReattempt: boolean | null;
  readonly nextAttemptAt: string | null;
  readonly customerReached: boolean | null;
  readonly place: string | null;
}

export interface AssistantFailedDelivery {
  readonly orderNumber: string;
  readonly orderStatus: string;
  readonly parcels: ReadonlyArray<{
    readonly awbNumber: string | null;
    readonly courier: string;
    readonly status: string;
    readonly courierStatusLine: string | null;
    readonly expectedDeliveryAt: string | null;
  }>;
  readonly failedAttempts: readonly AssistantFailedAttempt[];
}

/**
 * What the assistant may read about a failed delivery: the NDR reason and
 * the attempts, cut from the order journey the order page already shows.
 *
 * `OrderJourneyService.forOrder(orderId, sellerId)` applies the tenant
 * boundary in its query (a seller id is passed INTO the `where`, so another
 * client's order is a miss), and shows a seller only the events marked
 * visible to them. This projection then keeps CUSTOMER-SAFE fields only:
 * the driver's name and phone, the driver's free-text notes and the
 * customer's reply are deliberately left out — the first two are a person's
 * phone number, and free text is the shape a stored instruction would
 * arrive in. Money (collectable amounts, weights) is not copied either.
 */
@Injectable()
export class OrderJourneyAssistantReadService {
  constructor(private readonly journey: OrderJourneyService) {}

  /** `sellerId` null = staff (any order). */
  async forOrder(
    orderId: string,
    sellerId: string | null,
  ): Promise<AssistantFailedDelivery | null> {
    let j: Awaited<ReturnType<OrderJourneyService['forOrder']>>;
    try {
      j = await this.journey.forOrder(orderId, sellerId);
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
    return {
      orderNumber: j.orderNumber,
      orderStatus: String(j.orderStatus),
      parcels: j.parcels.map((p) => ({
        awbNumber: p.awbNumber,
        courier: p.courierCode,
        status: String(p.status),
        courierStatusLine: p.courierStatusLine,
        expectedDeliveryAt: p.expectedDeliveryAt?.toISOString() ?? null,
      })),
      failedAttempts: j.timeline
        .flatMap((e) => (e.attempt === null ? [] : [{ e, a: e.attempt }]))
        .slice(0, 5)
        .map(({ e, a }) => ({
          attemptNumber: a.number,
          at: e.at.toISOString(),
          reason: a.reason,
          courierCode: a.nsl?.code ?? e.nslCode,
          meaning: a.nsl?.plain ?? null,
          canAskForReattempt: a.nsl === null ? null : a.nsl.reAttemptable,
          nextAttemptAt: a.nextAttemptAt?.toISOString() ?? null,
          customerReached: a.contactedCustomer,
          place: e.location,
        })),
    };
  }
}
