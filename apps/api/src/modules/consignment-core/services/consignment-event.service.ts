import { Injectable } from '@nestjs/common';
import { ActorType, ConsignmentEventType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export interface AppendConsignmentEventInput {
  readonly consignmentId: string;
  readonly type: ConsignmentEventType;
  readonly description?: string | null;
  readonly data?: Prisma.InputJsonValue | undefined;
  readonly actorType?: ActorType | null;
  readonly actorId?: string | null;
  /**
   * Defaults TRUE, the opposite of `order_events`. A consignment's
   * timeline exists BECAUSE the seller asked to watch their stock move;
   * an event they cannot see is the exception here, not the rule.
   */
  readonly isVisibleToSeller?: boolean;
}

/**
 * The ONLY writer of `consignment_events`, which is APPEND-ONLY — no
 * update or delete path exists by construction (same discipline as
 * `order_events` / `stock_movements` / `call_attempts`).
 *
 * Lives in the dependency-free `consignment-core` module because BOTH
 * sides need it and neither may import the other: `consignment` owns
 * declaration and dispatch, while `inventory-receipt` is what discovers
 * that a leg has been counted. Wiring it into either one would close a
 * cycle — the R3 extraction instead of a forwardRef, for the eighth time.
 */
@Injectable()
export class ConsignmentEventService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: AppendConsignmentEventInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const db = tx ?? this.prisma.client;
    return db.consignmentEvent.create({
      data: {
        consignmentId: input.consignmentId,
        type: input.type,
        description: input.description ?? null,
        ...(input.data === undefined ? {} : { data: input.data }),
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        isVisibleToSeller: input.isVisibleToSeller ?? true,
      },
      select: { id: true },
    });
  }

  /** Oldest first — a timeline is read in the order things happened. */
  async listForConsignment(
    consignmentId: string,
    opts: { readonly sellerVisibleOnly?: boolean } = {},
  ): Promise<
    Array<{
      id: string;
      type: ConsignmentEventType;
      description: string | null;
      data: Prisma.JsonValue | null;
      createdAt: Date;
    }>
  > {
    return this.prisma.client.consignmentEvent.findMany({
      where: {
        consignmentId,
        ...(opts.sellerVisibleOnly === true ? { isVisibleToSeller: true } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, description: true, data: true, createdAt: true },
    });
  }
}
