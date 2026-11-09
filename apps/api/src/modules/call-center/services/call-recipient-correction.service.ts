import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CallQueueStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { OrderRecipientCorrectionService } from '../../order/services/order-recipient-correction.service';
import type { CallRecipientCorrection } from '../../order/services/order.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

/**
 * An agent corrects the customer's details while the customer is on the
 * line (2026-11-09).
 *
 * This service owns exactly one thing: proving the agent HOLDS the call.
 * The queue tables are this module's (CC-1), so the check lives here; the
 * order module is told only an order id and which call it happened on, and
 * decides everything about the order itself (route, ORD-5, event).
 *
 * Deliberately NOT part of `CallAttemptService.recordAttempt`: the
 * correction is its own write, saved BEFORE the outcome is chosen, so a
 * failed correction can never entangle with — or roll back — an attempt
 * (CC-3), and an attempt can never be what un-does a correction.
 */
@Injectable()
export class CallRecipientCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderRecipientCorrectionService,
  ) {}

  async correct(
    assignmentId: string,
    agentId: string,
    patch: CallRecipientCorrection,
    ctx: ClientContext,
  ): Promise<{ saved: true }> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: assignmentId },
      select: { orderId: true, status: true, assignedAgentId: true },
    });
    if (!entry) throw new NotFoundException(`Assignment ${assignmentId} not found`);
    if (entry.status !== CallQueueStatus.ASSIGNED) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_ACTIVE',
        message: `Assignment is ${entry.status}, not ASSIGNED`,
      });
    }
    if (entry.assignedAgentId !== agentId) {
      throw new ForbiddenException({
        code: 'ASSIGNMENT_NOT_OWNED',
        message: 'Assignment is held by another agent',
      });
    }
    await this.orders.correctOnCall(entry.orderId, patch, { assignmentId, agentId }, ctx);
    return { saved: true };
  }
}
