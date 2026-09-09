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
 * Severity is written BOTH to the `severity` column and into
 * `metadata.severity`. The column carries the partial index that makes
 * severity filterable; the metadata copy keeps every existing reader
 * working.
 */
// CRITICAL added for Module 6 god mode (OrderAdminOverrideService
// .forceMutate) — an admin deliberately bypassing the state machine /
// edit rules is the highest-severity audited action. Additive widening;
// severity is a metadata.severity string (no schema column), so no
// existing caller is affected.
/**
 * Kept as a local union rather than re-exporting the generated enum.
 *
 * Every call site passes a plain string literal, which is assignable to
 * both — swapping to the enum would be churn across a hundred files to
 * express the same four values.
 */
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

/** `audit_logs.entity_id` is a uuid column; anything else belongs in metadata. */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
      /*
        ── A NON-UUID entityId USED TO LOSE THE WHOLE ROW ──────────────

        `audit_logs.entity_id` is `@db.Uuid`. Hand it a courier code or a
        warehouse name and Postgres rejects the INSERT (P2023), the catch
        below swallows it, and the action is left with no audit trail at
        all — while the action itself succeeded. Found in production on
        2026-09-09: switching the Delhivery portal channel off recorded
        nothing, and the only sign was one ERROR line in the process log.

        The convention is `entityId: null` with the identifier in
        metadata, and most callers follow it. This is the backstop for
        the ones that do not: keep the row, move the value to
        `metadata.entityRef`. A slightly less convenient audit row beats
        no audit row, which is the whole point of the table — and losing
        it silently on the security-relevant actions is exactly the wrong
        way round.

        Deliberately NOT throwing: an audit write has never been allowed
        to fail the operation that scheduled it, and making this the one
        exception would mean a bad `entityId` could roll back a real
        state change.
      */
      let entityId = input.entityId ?? null;
      let entityRef: string | null = null;
      if (entityId !== null && !UUID.test(entityId)) {
        entityRef = entityId;
        entityId = null;
        this.logger.warn(
          { action: input.action, entityType: input.entityType, entityRef },
          'entityId is not a UUID — recorded in metadata instead (audit_logs.entity_id is a uuid column)',
        );
      }
      const row = await client.auditLog.create({
        data: {
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          staffUserId: input.staffUserId ?? null,
          sellerId: input.sellerId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId,
          changes: input.changes ?? Prisma.DbNull,
          metadata:
            entityRef === null
              ? (metadata ?? Prisma.DbNull)
              : ({
                  ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
                  entityRef,
                } as Prisma.InputJsonValue),
          // Written to the COLUMN as well as into metadata.
          //
          // The column is what makes "everything CRITICAL this month" a
          // question anyone can afford to ask — it was a JSON scan over
          // the largest table we keep. Metadata keeps it too because
          // every existing reader and test assertion goes through
          // `metadata.severity`, and breaking those to avoid one
          // duplicated string would be a poor trade.
          // The local union's members are the generated enum's keys, so
          // the literal is assignable — no import, and callers keep
          // passing plain strings.
          severity: input.severity ?? 'LOW',
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
