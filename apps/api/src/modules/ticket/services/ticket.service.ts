import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  Prisma,
  type RtoItemCondition,
  TicketStatus,
  TicketType,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { TicketStateMachineService } from './ticket-state-machine.service';

export interface TicketActor {
  readonly type: ActorType;
  readonly staffId?: string | null;
  readonly sellerUserId?: string | null;
}

export interface OpenTicketInput {
  readonly ticketType: TicketType;
  readonly sellerId: string;
  readonly subject: string;
  readonly description?: string | null;
  readonly orderId?: string | null;
  readonly shipmentId?: string | null;
  readonly shipmentItemId?: string | null;
  readonly courierCode?: string | null;
  readonly rtoCondition?: RtoItemCondition | null;
}

export interface ResolveTicketInput {
  readonly to: TicketStatus;
  readonly notes?: string | null;
  /** Required (and only permitted) when `to` is RESOLVED_REFUND. */
  readonly refundAmountInr?: string | null;
}

export interface TicketView {
  readonly id: string;
  readonly ticketType: TicketType;
  readonly status: TicketStatus;
  readonly sellerId: string;
  readonly orderId: string | null;
  readonly shipmentId: string | null;
  readonly shipmentItemId: string | null;
  readonly courierCode: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly resolutionWalletEntryId: string | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

/**
 * R7 — sole writer of `tickets` + `ticket_events`.
 *
 * Every status change appends a TicketEvent in the SAME transaction as
 * the status write, so the negotiation history can never disagree with
 * the current status. `ticket_events` is append-only (no update/delete
 * path exists here by construction), matching order_events /
 * stock_movements / audit_logs.
 *
 * RESOLVED_REFUND is the only status that moves money: it writes a
 * SCRAP_REFUND wallet credit through `WalletService.applyEntry` (the
 * INV-1-style sole ledger writer) inside the same transaction and stores
 * the resulting entry id on the ticket, so a settlement can always be
 * traced to its ledger row and vice versa.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
    private readonly stateMachine: TicketStateMachineService,
  ) {}

  /**
   * Opens a ticket. Idempotent for auto-raised SCRAP_DAMAGE: a second
   * call for the same `shipmentItemId` + type returns the existing
   * ticket instead of creating a duplicate (the operator may re-inspect
   * a line and correct their judgement). Accepts an optional caller
   * transaction so RTO inspection can create the ticket atomically with
   * the inspection write.
   */
  async open(
    input: OpenTicketInput,
    actor: TicketActor,
    tx?: Prisma.TransactionClient,
  ): Promise<TicketView> {
    const client = tx ?? this.prisma.client;

    if (input.shipmentItemId) {
      const existing = await client.ticket.findUnique({
        where: {
          shipmentItemId_ticketType: {
            shipmentItemId: input.shipmentItemId,
            ticketType: input.ticketType,
          },
        },
      });
      if (existing) return this.toView(existing);
    }

    const created = await client.ticket.create({
      data: {
        ticketType: input.ticketType,
        status: TicketStatus.OPEN,
        sellerId: input.sellerId,
        subject: input.subject,
        description: input.description ?? null,
        orderId: input.orderId ?? null,
        shipmentId: input.shipmentId ?? null,
        shipmentItemId: input.shipmentItemId ?? null,
        courierCode: input.courierCode ?? null,
        rtoCondition: input.rtoCondition ?? null,
        openedByStaffId: actor.staffId ?? null,
        openedBySellerUserId: actor.sellerUserId ?? null,
      },
    });

    await client.ticketEvent.create({
      data: {
        ticketId: created.id,
        fromStatus: null,
        toStatus: TicketStatus.OPEN,
        note: 'Ticket opened',
        actorType: actor.type,
        actorId: actor.staffId ?? actor.sellerUserId ?? null,
      },
    });

    await this.audit.log(
      {
        actorType: actor.type,
        staffUserId: actor.staffId ?? null,
        sellerId: input.sellerId,
        action: 'ticket.opened',
        entityType: 'ticket',
        entityId: created.id,
        severity: 'MEDIUM',
        metadata: {
          ticketType: input.ticketType,
          shipmentItemId: input.shipmentItemId ?? null,
          rtoCondition: input.rtoCondition ?? null,
        },
      },
      tx,
    );

    return this.toView(created);
  }

  /**
   * Moves a ticket along the matrix. RESOLVED_REFUND additionally
   * credits the seller (SCRAP_REFUND) in the same transaction.
   */
  async transition(
    ticketId: string,
    input: ResolveTicketInput,
    actor: TicketActor,
  ): Promise<TicketView> {
    const existing = await this.prisma.client.ticket.findUnique({ where: { id: ticketId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    if (!this.stateMachine.canTransition(existing.status, input.to)) {
      throw new ConflictException({
        code: 'INVALID_TICKET_TRANSITION',
        message:
          `Cannot move ticket from ${existing.status} to ${input.to}. ` +
          `Allowed: ${this.stateMachine.allowedFrom(existing.status).join(', ') || '(terminal)'}`,
      });
    }

    const isRefund = input.to === TicketStatus.RESOLVED_REFUND;
    let refundAmount: Prisma.Decimal | null = null;
    if (isRefund) {
      if (!input.refundAmountInr) {
        throw new BadRequestException({
          code: 'REFUND_AMOUNT_REQUIRED',
          message: 'refundAmountInr is required when resolving as RESOLVED_REFUND',
        });
      }
      refundAmount = new Prisma.Decimal(input.refundAmountInr);
      if (refundAmount.lte(0)) {
        throw new BadRequestException({
          code: 'REFUND_AMOUNT_INVALID',
          message: 'refundAmountInr must be > 0',
        });
      }
    } else if (input.refundAmountInr) {
      // Guard against a caller passing an amount with the wrong target
      // status and assuming money moved.
      throw new BadRequestException({
        code: 'REFUND_AMOUNT_NOT_APPLICABLE',
        message: `refundAmountInr is only valid with RESOLVED_REFUND, not ${input.to}`,
      });
    }

    const terminal = this.stateMachine.isTerminal(input.to);

    const updated = await this.prisma.client.$transaction(async (tx) => {
      let walletEntryId: string | null = null;
      if (refundAmount) {
        const entry = await this.wallet.applyEntry(tx, {
          sellerId: existing.sellerId,
          currency: Currency.INR,
          direction: WalletEntryDirection.SCRAP_REFUND,
          amount: refundAmount,
          linkedOrderId: existing.orderId,
          note: `Ticket ${ticketId} settled`,
          actorType: actor.type,
          actorId: actor.staffId ?? null,
        });
        walletEntryId = entry.id;
      }

      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: input.to,
          resolutionNotes: input.notes ?? existing.resolutionNotes,
          ...(refundAmount ? { resolutionAmountInr: refundAmount } : {}),
          ...(walletEntryId ? { resolutionWalletEntryId: walletEntryId } : {}),
          ...(terminal
            ? { resolvedAt: new Date(), resolvedByStaffId: actor.staffId ?? null }
            : {}),
        },
      });

      await tx.ticketEvent.create({
        data: {
          ticketId,
          fromStatus: existing.status,
          toStatus: input.to,
          note: input.notes ?? null,
          actorType: actor.type,
          actorId: actor.staffId ?? actor.sellerUserId ?? null,
        },
      });

      return row;
    });

    if (refundAmount) {
      // Post-commit, best-effort (mirrors the accrual listener).
      await this.wallet.recomputeCacheAfterCommit(
        existing.sellerId,
        Currency.INR,
        'post-ticket-refund',
      );
    }

    await this.audit.log({
      actorType: actor.type,
      staffUserId: actor.staffId ?? null,
      sellerId: existing.sellerId,
      action: 'ticket.transitioned',
      entityType: 'ticket',
      entityId: ticketId,
      severity: 'MEDIUM',
      changes: { from: existing.status, to: input.to },
      metadata: {
        refundAmountInr: refundAmount?.toFixed(2) ?? null,
        resolutionWalletEntryId: updated.resolutionWalletEntryId,
      },
    });

    return this.toView(updated);
  }

  async listForSeller(
    sellerId: string,
    status?: TicketStatus,
  ): Promise<readonly TicketView[]> {
    const rows = await this.prisma.client.ticket.findMany({
      where: { sellerId, ...(status === undefined ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /** Seller-scoped detail read — never leaks another seller's ticket. */
  async getForSeller(sellerId: string, ticketId: string): Promise<TicketView> {
    const row = await this.prisma.client.ticket.findFirst({
      where: { id: ticketId, sellerId },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    return this.toView(row);
  }

  async listForAdmin(filters: {
    sellerId?: string;
    status?: TicketStatus;
    ticketType?: TicketType;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: readonly TicketView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const where = {
      ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.ticketType === undefined ? {} : { ticketType: filters.ticketType }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.client.ticket.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total, page, pageSize };
  }

  async listEvents(ticketId: string): Promise<
    readonly {
      id: string;
      fromStatus: TicketStatus | null;
      toStatus: TicketStatus;
      note: string | null;
      actorType: ActorType;
      createdAt: Date;
    }[]
  > {
    return this.prisma.client.ticketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        actorType: true,
        createdAt: true,
      },
    });
  }

  private toView(row: {
    id: string;
    ticketType: TicketType;
    status: TicketStatus;
    sellerId: string;
    orderId: string | null;
    shipmentId: string | null;
    shipmentItemId: string | null;
    courierCode: string | null;
    subject: string;
    description: string | null;
    resolutionAmountInr: Prisma.Decimal | null;
    resolutionWalletEntryId: string | null;
    resolutionNotes: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
  }): TicketView {
    return {
      id: row.id,
      ticketType: row.ticketType,
      status: row.status,
      sellerId: row.sellerId,
      orderId: row.orderId,
      shipmentId: row.shipmentId,
      shipmentItemId: row.shipmentItemId,
      courierCode: row.courierCode,
      subject: row.subject,
      description: row.description,
      resolutionAmountInr: row.resolutionAmountInr?.toFixed(2) ?? null,
      resolutionWalletEntryId: row.resolutionWalletEntryId,
      resolutionNotes: row.resolutionNotes,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    };
  }
}
