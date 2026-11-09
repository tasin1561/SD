import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ActorType, OrderStatus, Prisma, QueueClosureReason } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { ConfirmationPolicyService } from '../../confirmation-policy/confirmation-policy.service';
import type { EventActor } from './order-event-writer.service';
import { OrderWriteService } from './order-write.service';

export interface AwaitingConfirmationRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly codAmountInr: string;
  readonly itemCount: number;
  readonly createdAt: Date;
  /** null when no TTL clock is running (calls are on for this client). */
  readonly confirmationDeadlineAt: Date | null;
  /** The client's resolved `ops.call_confirmation_required`. */
  readonly callsRequired: boolean;
}

export type SendCallOutcome =
  | 'QUEUED'
  | 'ALREADY_QUEUED'
  | 'NOT_FOUND'
  | 'NOT_PENDING_CONFIRMATION'
  | 'FAILED';

export interface SendCallResult {
  readonly orderId: string;
  readonly outcome: SendCallOutcome;
  readonly message?: string;
}

export type ConfirmWithoutCallOutcome =
  | 'CONFIRMED'
  | 'OUT_OF_STOCK'
  | 'NOT_FOUND'
  | 'NOT_PENDING_CONFIRMATION'
  | 'REFUSED'
  | 'FAILED';

export interface ConfirmWithoutCallResult {
  readonly orderId: string;
  readonly outcome: ConfirmWithoutCallOutcome;
  /** What was actually persisted — CONFIRMED, or OUT_OF_STOCK if nothing could be reserved. */
  readonly landedStatus?: OrderStatus;
  /** The server's own refusal code and words, for the UI to show verbatim (FE-2). */
  readonly code?: string;
  readonly message?: string;
}

/**
 * The `reason` on the STATUS_CHANGED event. Deliberately not the sweeper's
 * AUTO_CONFIRM_EVENT_TEXT: "a person decided" and "a timer expired" are
 * different facts and the timeline must not read them as the same one.
 */
export const CONFIRMED_WITHOUT_CALL_EVENT_TEXT =
  'Confirmed by a person without a confirmation call — nobody phoned the customer';

/** The audit action. Distinct from the sweeper's `order.auto_confirmed_ttl`. */
export const CONFIRMED_WITHOUT_CALL_AUDIT_ACTION = 'order.confirmed_without_call';

/**
 * The "awaiting confirmation" worklist: PENDING_CONFIRMATION orders with
 * no open call-queue entry (calls are off for the client, or the entry
 * was closed), and the action that sends chosen ones to agents.
 *
 * `scopeSellerId` is the client scope. Seller routes always pass it; an
 * order belonging to anyone else is reported NOT_FOUND — the same answer
 * as an id that does not exist.
 */
@Injectable()
export class AwaitingConfirmationService {
  private readonly logger = new Logger(AwaitingConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: ConfirmationPolicyService,
    // ORD-3: the only cross-module order-status write.
    private readonly orderWrite: OrderWriteService,
    // CC-1: the ONLY cross-module call-queue surface.
    private readonly callQueue: CallQueueService,
    private readonly audit: AuditLogService,
  ) {}

  async list(opts: {
    sellerId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: AwaitingConfirmationRow[]; total: number; page: number; pageSize: number }> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: OrderStatus.PENDING_CONFIRMATION,
      ...CallQueueService.orderHasNoOpenEntry(),
      ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          orderNumber: true,
          sellerId: true,
          seller: { select: { companyName: true } },
          recipientName: true,
          recipientCity: true,
          codAmountInr: true,
          createdAt: true,
          confirmationDeadlineAt: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.client.order.count({ where }),
    ]);
    const required = new Map<string, boolean>();
    for (const sellerId of new Set(rows.map((r) => r.sellerId))) {
      required.set(sellerId, await this.policy.callsRequired(sellerId));
    }
    return {
      items: rows.map((r) => ({
        id: r.id,
        orderNumber: r.orderNumber,
        clientId: r.sellerId,
        clientName: r.seller.companyName,
        recipientName: r.recipientName,
        recipientCity: r.recipientCity,
        codAmountInr: r.codAmountInr?.toString() ?? '0',
        itemCount: r._count.items,
        createdAt: r.createdAt,
        confirmationDeadlineAt: r.confirmationDeadlineAt,
        callsRequired: required.get(r.sellerId) ?? true,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** Per-order outcomes; one bad id never fails the batch. Idempotent. */
  async sendToAgents(
    orderIds: readonly string[],
    opts: { scopeSellerId?: string; ctx?: ClientContext },
  ): Promise<{ results: SendCallResult[] }> {
    const results: SendCallResult[] = [];
    for (const orderId of new Set(orderIds)) {
      try {
        const order = await this.prisma.client.order.findFirst({
          where: {
            id: orderId,
            deletedAt: null,
            ...(opts.scopeSellerId ? { sellerId: opts.scopeSellerId } : {}),
          },
          select: { status: true },
        });
        if (!order) {
          results.push({ orderId, outcome: 'NOT_FOUND' });
          continue;
        }
        if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
          results.push({ orderId, outcome: 'NOT_PENDING_CONFIRMATION' });
          continue;
        }
        // Clear-then-enqueue inside the policy, so a TTL sweep can never
        // confirm an order a human has just queued for a call.
        const r = await this.policy.queueForCall(orderId, opts.ctx);
        results.push({ orderId, outcome: r.created ? 'QUEUED' : 'ALREADY_QUEUED' });
      } catch (e) {
        this.logger.error({ orderId, err: (e as Error).message }, 'Send-to-agents failed');
        results.push({ orderId, outcome: 'FAILED', message: (e as Error).message });
      }
    }
    return { results };
  }

  /**
   * Confirm chosen orders NOW, with no call and without waiting for the TTL.
   *
   * The same mechanism the TTL sweeper uses — `transitionStatus` to the
   * confirmed target with `expectedFrom: PENDING_CONFIRMATION` (ORD-3) — so
   * the M5 reserve saga runs as always and an order with nothing to reserve
   * lands OUT_OF_STOCK, reported per order rather than hidden.
   *
   * Three deliberate differences from the sweeper:
   *   • NO `autoConfirmClaim`. That turns the write into a claim on
   *     `confirmation_deadline_at` being SET AND DUE, which a human press has
   *     nothing to claim (most of these orders have no clock running at all).
   *     `expectedFrom` is the concurrency guard; a second press gets the
   *     normal 409.
   *   • NOT god mode (ORD-2). This is a sanctioned business action and must
   *     not set `hasAdminOverride` — that flag means "god mode touched this".
   *   • The actor is the real human (staff on admin, seller user on client),
   *     never SYSTEM, and the audit action is its own name.
   *
   * The target is `CONFIRMED` directly rather than via
   * `CallOutcomeMappingService`: that service belongs to the call-centre
   * module (CC-2) and the order module does not depend on it — the same
   * choice the existing `retry-stock` admin action makes.
   *
   * Per-order outcomes; one order's refusal never fails the batch.
   */
  async confirmWithoutCall(
    orderIds: readonly string[],
    opts: { actor: EventActor; scopeSellerId?: string; ctx?: ClientContext },
  ): Promise<{ results: ConfirmWithoutCallResult[] }> {
    const results: ConfirmWithoutCallResult[] = [];
    for (const orderId of new Set(orderIds)) {
      try {
        const order = await this.prisma.client.order.findFirst({
          where: {
            id: orderId,
            deletedAt: null,
            ...(opts.scopeSellerId ? { sellerId: opts.scopeSellerId } : {}),
          },
          select: { status: true, sellerId: true, orderNumber: true },
        });
        if (!order) {
          results.push({ orderId, outcome: 'NOT_FOUND' });
          continue;
        }
        if (order.status !== OrderStatus.PENDING_CONFIRMATION) {
          results.push({
            orderId,
            outcome: 'NOT_PENDING_CONFIRMATION',
            code: 'NOT_PENDING_CONFIRMATION',
            message: `Order is ${order.status}`,
          });
          continue;
        }

        const res = await this.orderWrite.transitionStatus({
          orderId,
          to: OrderStatus.CONFIRMED,
          expectedFrom: OrderStatus.PENDING_CONFIRMATION,
          actor: opts.actor,
          reason: CONFIRMED_WITHOUT_CALL_EVENT_TEXT,
          ...(opts.ctx ? { ctx: opts.ctx } : {}),
        });

        // An agent must never ring a customer about an order already in
        // packing. The post-commit exit hook closes the entry too; this
        // call is idempotent ({dequeued:0}) and makes the guarantee local
        // to the action rather than a side effect of another module.
        await this.closeOpenCall(orderId, res.status, opts.ctx);
        await this.auditConfirmation(order.sellerId, order.orderNumber, orderId, res.status, opts);

        results.push({
          orderId,
          outcome: res.status === OrderStatus.CONFIRMED ? 'CONFIRMED' : 'OUT_OF_STOCK',
          landedStatus: res.status,
        });
      } catch (e) {
        const refusal = readRefusal(e);
        if (refusal !== null) {
          // A guardrail spoke (stale status, seller on hold, invalid edge).
          // Its own words travel to the operator untouched (FE-2).
          results.push({ orderId, outcome: 'REFUSED', ...refusal });
          continue;
        }
        this.logger.error({ orderId, err: (e as Error).message }, 'Confirm-without-call failed');
        results.push({ orderId, outcome: 'FAILED', message: (e as Error).message });
      }
    }
    return { results };
  }

  /** CC-1: through CallQueueService only; never `call_queue_entries`. */
  private async closeOpenCall(
    orderId: string,
    landed: OrderStatus,
    ctx?: ClientContext,
  ): Promise<void> {
    try {
      await this.callQueue.dequeueOrder(
        orderId,
        landed === OrderStatus.CONFIRMED
          ? QueueClosureReason.ORDER_CONFIRMED
          : QueueClosureReason.ADMIN_CLOSED,
        ctx,
      );
    } catch (e) {
      // The status is already persisted; the entry self-heals on the next
      // dequeue. Never turn a confirmed order into a reported failure.
      this.logger.error(
        { orderId, landed, err: (e as Error).message },
        'Confirm-without-call: call-queue close failed; status persisted',
      );
    }
  }

  private async auditConfirmation(
    sellerId: string,
    orderNumber: string,
    orderId: string,
    landed: OrderStatus,
    opts: { actor: EventActor; ctx?: ClientContext },
  ): Promise<void> {
    const actorId = opts.actor.id ?? null;
    await this.audit
      .log({
        actorType: opts.actor.type,
        actorId,
        ...(opts.actor.type === ActorType.STAFF ? { staffUserId: actorId } : {}),
        sellerId,
        action: CONFIRMED_WITHOUT_CALL_AUDIT_ACTION,
        entityType: 'order',
        entityId: orderId,
        // A person chose to skip the COD confirmation call, which is the
        // step that holds RTO down in this market. Not routine.
        severity: 'MEDIUM',
        metadata: {
          orderNumber,
          landedStatus: landed,
          noCallMade: true,
          reason: CONFIRMED_WITHOUT_CALL_EVENT_TEXT,
          ipAddress: opts.ctx?.ipAddress ?? null,
          userAgent: opts.ctx?.userAgent ?? null,
          requestId: opts.ctx?.requestId ?? null,
        },
      })
      .catch(() => undefined);
  }
}

/** A guardrail's `{ code, message }` body, read back for a per-order report. */
function readRefusal(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof HttpException)) return null;
  const body: unknown = e.getResponse();
  if (typeof body === 'object' && body !== null) {
    const o = body as { code?: unknown; message?: unknown };
    return {
      code: typeof o.code === 'string' ? o.code : 'REFUSED',
      message: typeof o.message === 'string' ? o.message : e.message,
    };
  }
  return { code: 'REFUSED', message: typeof body === 'string' ? body : e.message };
}
