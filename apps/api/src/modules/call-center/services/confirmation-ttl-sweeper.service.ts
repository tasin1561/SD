import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ActorType, CallOutcome, OrderStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallOutcomeMappingService } from './call-outcome-mapping.service';
import { ConfirmationPolicyService } from '../../confirmation-policy/confirmation-policy.service';
import { OrderWriteService } from '../../order/services/order-write.service';

const BATCH = 200;

export const AUTO_CONFIRM_EVENT_TEXT =
  'Auto-confirmed on TTL expiry — NO confirmation call was made (confirmation calls are off for this client)';

export interface SweepResult {
  readonly confirmed: number;
  readonly queued: number;
  readonly skipped: number;
}

/**
 * Confirms, without a call, PENDING_CONFIRMATION orders whose
 * `confirmation_deadline_at` has passed.
 *
 * The target status is read from `CallOutcomeMappingService` for a
 * CONFIRMED outcome (CC-2: that table is the one source of truth), so an
 * auto-confirm and a human confirm leave the order in the same state —
 * including the M5 reserve saga possibly landing it OUT_OF_STOCK.
 *
 * The claim is a guarded `updateMany` inside the writing transaction
 * (`autoConfirmClaim` on OrderWriteService.transitionStatus), so a human
 * confirming at the same instant and this sweeper cannot both win.
 */
@Injectable()
export class ConfirmationTtlSweeperService {
  private readonly logger = new Logger(ConfirmationTtlSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orderWrite: OrderWriteService,
    private readonly policy: ConfirmationPolicyService,
    private readonly mapping: CallOutcomeMappingService,
    private readonly audit: AuditLogService,
  ) {}

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const due = await this.prisma.client.order.findMany({
      where: {
        status: OrderStatus.PENDING_CONFIRMATION,
        deletedAt: null,
        confirmationDeadlineAt: { not: null, lte: now },
      },
      orderBy: { confirmationDeadlineAt: 'asc' },
      take: BATCH,
      select: { id: true, sellerId: true, orderNumber: true },
    });

    const target = this.mapping.resolve(CallOutcome.CONFIRMED, {
      priorAttemptCount: 0,
      maxAttempts: 1,
      atCapPolicy: 'REJECT',
    }).targetStatus;
    if (target === null) return { confirmed: 0, queued: 0, skipped: due.length };

    let confirmed = 0;
    let queued = 0;
    let skipped = 0;
    for (const o of due) {
      try {
        // The client switched calls back ON while this order waited: send
        // it to the call queue rather than confirming it unspoken-to.
        if (await this.policy.callsRequired(o.sellerId)) {
          await this.policy.enqueueOrDefer(o.id);
          queued += 1;
          continue;
        }
        const res = await this.orderWrite.transitionStatus({
          orderId: o.id,
          to: target,
          expectedFrom: OrderStatus.PENDING_CONFIRMATION,
          actor: { type: ActorType.SYSTEM, id: null },
          reason: AUTO_CONFIRM_EVENT_TEXT,
          autoConfirmClaim: true,
        });
        confirmed += 1;
        await this.audit
          .log({
            actorType: ActorType.SYSTEM,
            actorId: null,
            sellerId: o.sellerId,
            action: 'order.auto_confirmed_ttl',
            entityType: 'order',
            entityId: o.id,
            metadata: {
              orderNumber: o.orderNumber,
              landedStatus: res.status,
              noCallMade: true,
              reason: AUTO_CONFIRM_EVENT_TEXT,
            },
          })
          .catch(() => undefined);
      } catch (e) {
        // Lost the claim to a human confirm / enqueue / cancel: not an error.
        if (e instanceof ConflictException) {
          skipped += 1;
          continue;
        }
        skipped += 1;
        this.logger.error(
          { orderId: o.id, err: (e as Error).message },
          'TTL auto-confirm failed; will retry next sweep',
        );
      }
    }
    return { confirmed, queued, skipped };
  }
}
