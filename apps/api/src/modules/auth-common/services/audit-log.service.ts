import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Action-code taxonomy: `<actor_type>.<action>.<result>` where applicable.
 *
 *   Examples:
 *     - staff.login.success
 *     - staff.login.failure
 *     - seller.login.success
 *     - seller.login.failure
 *     - staff.logout.success
 *     - seller.password_reset.requested
 *     - seller.password_reset.completed
 *     - staff.email_verification.requested
 *     - staff.email_verification.completed
 *     - staff.refresh.rotated
 *     - seller.refresh.rotated
 *     - seller.api_key.created
 *     - seller.api_key.revoked
 *     - staff.seller_invitation.created
 *     - security.refresh_replay_detected           (severity HIGH)
 *     - security.api_key.invalid                   (severity LOW)
 *
 * Entries are append-only (the underlying table is not modified after insert).
 * Severity goes into `metadata.severity` since the schema has no severity column.
 */
// CRITICAL added for Module 6 god mode (OrderAdminOverrideService
// .forceMutate) — an admin deliberately bypassing the state machine /
// edit rules is the highest-severity audited action. Additive widening;
// severity is a metadata.severity string (no schema column), so no
// existing caller is affected.
export type AuditSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface AuditLogInput {
  actorType: ActorType;
  /** Generic actor id — set this when the staff/seller-typed fields don't apply (system/API). */
  actorId?: string | null;
  staffUserId?: string | null;
  sellerId?: string | null;
  action: string;
  entityType: string;
  /** Null when the action has no specific entity (e.g., login failure with unknown email). */
  entityId?: string | null;
  changes?: Prisma.InputJsonValue | null;
  metadata?: Record<string, unknown> | null;
  severity?: AuditSeverity;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist an audit log row. Best-effort: failures are logged but never
   * thrown, so an audit write cannot crash the auth flow that scheduled it.
   * Callers that need to guarantee the row is written (e.g., reuse detection)
   * should `await` and check; we still won't throw, but the returned id is
   * `null` when the write failed.
   */
  async log(input: AuditLogInput, tx?: Prisma.TransactionClient): Promise<string | null> {
    try {
      const metadata = this.composeMetadata(input);
      const client = tx ?? this.prisma.client;
      const row = await client.auditLog.create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          staffUserId: input.staffUserId ?? null,
          sellerId: input.sellerId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          changes: input.changes ?? Prisma.DbNull,
          metadata: metadata ?? Prisma.DbNull,
        },
        select: { id: true },
      });
      return row.id;
    } catch (err) {
      this.logger.error(
        {
          err,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
        },
        'Failed to write audit log row',
      );
      return null;
    }
  }

  private composeMetadata(input: AuditLogInput): Prisma.InputJsonValue | null {
    const base = input.metadata ? { ...input.metadata } : null;
    if (!input.severity) return base as Prisma.InputJsonValue | null;
    const out = base ?? {};
    out['severity'] = input.severity;
    return out as Prisma.InputJsonValue;
  }
}

