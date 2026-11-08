import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CallQueueService } from '../../call-queue/services/call-queue.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { ConfirmationPolicyService } from '../../confirmation-policy/confirmation-policy.service';

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
}
