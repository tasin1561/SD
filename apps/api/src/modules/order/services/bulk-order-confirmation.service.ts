import { Injectable } from '@nestjs/common';
import type { ActorType } from '@skydrop/db';

import {
  type BulkOrderResponse,
  type BulkOrderResult,
  summariseBulk,
} from '../../../common/bulk/bulk-result';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import {
  AwaitingConfirmationService,
  type ConfirmWithoutCallResult,
  type SendCallResult,
} from './awaiting-confirmation.service';

interface Opts {
  /** The caller's own seller; absent for staff. Part of the query, not a post-filter. */
  readonly scopeSellerId?: string;
  readonly ctx?: ClientContext;
}

/**
 * Bulk "send for a confirmation call" and "confirm without a call".
 *
 * A wrapper and nothing more: the two single-order endpoints already take a
 * list and already report per order, so this calls the SAME service methods
 * (scope, state rules, saga and audit untouched) and only re-shapes their
 * answers into the one result every bulk action returns. The old endpoints
 * stay exactly as they are.
 *
 * Order numbers are read under the same seller scope, so an id the caller
 * does not own comes back SKIPPED / NOT_FOUND with no number.
 */
@Injectable()
export class BulkOrderConfirmationService {
  constructor(
    private readonly awaiting: AwaitingConfirmationService,
    private readonly prisma: PrismaService,
  ) {}

  async sendCalls(orderIds: readonly string[], opts: Opts): Promise<BulkOrderResponse> {
    const { results } = await this.awaiting.sendToAgents(orderIds, {
      ...(opts.scopeSellerId === undefined ? {} : { scopeSellerId: opts.scopeSellerId }),
      ...(opts.ctx === undefined ? {} : { ctx: opts.ctx }),
    });
    const numbers = await this.numbers(
      results.map((r) => r.orderId),
      opts.scopeSellerId,
    );
    return summariseBulk(results.map((r) => mapSend(r, numbers.get(r.orderId) ?? null)));
  }

  async confirmWithoutCall(
    orderIds: readonly string[],
    opts: Opts & { actor: { type: ActorType; id: string } },
  ): Promise<BulkOrderResponse> {
    const { results } = await this.awaiting.confirmWithoutCall(orderIds, {
      actor: opts.actor,
      ...(opts.scopeSellerId === undefined ? {} : { scopeSellerId: opts.scopeSellerId }),
      ...(opts.ctx === undefined ? {} : { ctx: opts.ctx }),
    });
    const numbers = await this.numbers(
      results.map((r) => r.orderId),
      opts.scopeSellerId,
    );
    return summariseBulk(results.map((r) => mapConfirm(r, numbers.get(r.orderId) ?? null)));
  }

  private async numbers(
    ids: readonly string[],
    scopeSellerId: string | undefined,
  ): Promise<Map<string, string>> {
    const rows = await this.prisma.client.order.findMany({
      where: {
        id: { in: [...ids] },
        deletedAt: null,
        ...(scopeSellerId === undefined ? {} : { sellerId: scopeSellerId }),
      },
      select: { id: true, orderNumber: true },
    });
    return new Map(rows.map((r) => [r.id, r.orderNumber]));
  }
}

export function mapSend(r: SendCallResult, orderNumber: string | null): BulkOrderResult {
  const base = { orderId: r.orderId, orderNumber };
  switch (r.outcome) {
    case 'QUEUED':
      return { ...base, outcome: 'DONE' };
    case 'FAILED':
      return {
        ...base,
        outcome: 'FAILED',
        code: 'FAILED',
        ...(r.message === undefined ? {} : { message: r.message }),
      };
    default:
      // ALREADY_QUEUED / NOT_FOUND / NOT_PENDING_CONFIRMATION: nothing to do.
      return {
        ...base,
        outcome: 'SKIPPED',
        code: r.outcome,
        ...(r.message === undefined ? {} : { message: r.message }),
      };
  }
}

export function mapConfirm(
  r: ConfirmWithoutCallResult,
  orderNumber: string | null,
): BulkOrderResult {
  const base = { orderId: r.orderId, orderNumber };
  const detail = {
    code: r.code ?? r.outcome,
    ...(r.message === undefined ? {} : { message: r.message }),
  };
  switch (r.outcome) {
    case 'CONFIRMED':
      return { ...base, outcome: 'DONE' };
    case 'FAILED':
      return { ...base, outcome: 'FAILED', ...detail };
    default:
      // OUT_OF_STOCK / NOT_FOUND / NOT_PENDING_CONFIRMATION / REFUSED.
      return { ...base, outcome: 'SKIPPED', ...detail };
  }
}
