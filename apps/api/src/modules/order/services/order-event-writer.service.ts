import { Injectable } from '@nestjs/common';
import { ActorType, OrderEventType, OrderStatus, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

type TxOrClient = Prisma.TransactionClient | PrismaService['client'];

export interface EventActor {
  type: ActorType;
  id?: string | null;
}

export interface WriteEventInput {
  orderId: string;
  type: OrderEventType;
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus | null;
  description?: string | null;
  data?: Prisma.InputJsonValue | undefined;
  actor?: EventActor;
  /** Default false — most events are internal. */
  isVisibleToSeller?: boolean;
}

/**
 * ORD-4 — the ONLY writer of `order_events`, and it ONLY inserts.
 *
 * There is no update/delete path here by construction: the append-only
 * timeline is the audit substrate for the order lifecycle. Every method
 * takes an explicit client so writes participate in the caller's
 * transaction (ORD-3 requires the event write to be INSIDE the
 * status-change tx).
 *
 * The OrderEvent.type column is a fixed enum with no "admin override" /
 * "release reservations" members, so action-style events use the closest
 * enum value plus a structured `data.action` discriminator (see
 * `adminAction`). `data` is also where side-effect outcomes are recorded
 * — a single transition often writes the STATUS_CHANGED event plus one
 * STOCK_RESERVED/STOCK_RELEASED outcome event.
 */
@Injectable()
export class OrderEventWriterService {
  async write(client: TxOrClient, input: WriteEventInput): Promise<{ id: string }> {
    return client.orderEvent.create({
      data: {
        orderId: input.orderId,
        type: input.type,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        description: input.description ?? null,
        data: input.data ?? Prisma.JsonNull,
        actorType: input.actor?.type ?? null,
        actorId: input.actor?.id ?? null,
        isVisibleToSeller: input.isVisibleToSeller ?? false,
      },
      select: { id: true },
    });
  }

  /** Bulk append (e.g. status change + its side-effect outcome together). */
  async writeMany(client: TxOrClient, inputs: WriteEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await client.orderEvent.createMany({
      data: inputs.map((input) => ({
        orderId: input.orderId,
        type: input.type,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        description: input.description ?? null,
        data: input.data ?? Prisma.JsonNull,
        actorType: input.actor?.type ?? null,
        actorId: input.actor?.id ?? null,
        isVisibleToSeller: input.isVisibleToSeller ?? false,
      })),
    });
  }

  // ── Convenience helpers (all just `write`) ───────────────────────────

  created(
    client: TxOrClient,
    orderId: string,
    actor: EventActor,
    data?: Prisma.InputJsonValue,
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId,
      type: OrderEventType.CREATED,
      toStatus: OrderStatus.DRAFT,
      description: 'Order created',
      data,
      actor,
      isVisibleToSeller: true,
    });
  }

  statusChanged(
    client: TxOrClient,
    args: {
      orderId: string;
      from: OrderStatus;
      to: OrderStatus;
      actor: EventActor;
      description?: string;
      data?: Prisma.InputJsonValue;
      isVisibleToSeller?: boolean;
    },
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId: args.orderId,
      type: OrderEventType.STATUS_CHANGED,
      fromStatus: args.from,
      toStatus: args.to,
      description: args.description ?? `Status ${args.from} → ${args.to}`,
      data: args.data,
      actor: args.actor,
      isVisibleToSeller: args.isVisibleToSeller ?? true,
    });
  }

  stockReserved(
    client: TxOrClient,
    orderId: string,
    actor: EventActor,
    data: Prisma.InputJsonValue,
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId,
      type: OrderEventType.STOCK_RESERVED,
      description: 'Stock reserved',
      data,
      actor,
    });
  }

  stockReleased(
    client: TxOrClient,
    orderId: string,
    actor: EventActor,
    data: Prisma.InputJsonValue,
    description = 'Stock released',
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId,
      type: OrderEventType.STOCK_RELEASED,
      description,
      data,
      actor,
    });
  }

  note(
    client: TxOrClient,
    orderId: string,
    description: string,
    actor: EventActor,
    isVisibleToSeller = false,
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId,
      type: OrderEventType.NOTE_ADDED,
      description,
      actor,
      isVisibleToSeller,
    });
  }

  /**
   * Action-style event (god-mode override, manual reservation release).
   * Uses NOTE_ADDED + `data.action` since the enum has no dedicated
   * member; `data` carries reason + attempted-side-effect outcomes.
   */
  adminAction(
    client: TxOrClient,
    args: {
      orderId: string;
      action: string;
      reason: string;
      from?: OrderStatus | null;
      to?: OrderStatus | null;
      data?: Record<string, unknown>;
      actorId?: string | null;
    },
  ): Promise<{ id: string }> {
    return this.write(client, {
      orderId: args.orderId,
      type: OrderEventType.NOTE_ADDED,
      fromStatus: args.from ?? null,
      toStatus: args.to ?? null,
      description: `[${args.action}] ${args.reason}`,
      data: { action: args.action, reason: args.reason, ...(args.data ?? {}) } as Prisma.InputJsonValue,
      actor: { type: ActorType.STAFF, id: args.actorId ?? null },
      isVisibleToSeller: false,
    });
  }
}
