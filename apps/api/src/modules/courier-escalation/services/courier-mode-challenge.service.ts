import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, CourierWriteMode, NotificationRecipientType } from '@skydrop/db';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import {
  CourierChannelSettingsService,
  type ChannelSettingsView,
} from './courier-channel-settings.service';

const CHALLENGE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const MIN_REASON = 30;

/**
 * Two-step, code-to-your-inbox confirmation for a write-mode change.
 *
 * ── WHY THIS DESERVES THE CEREMONY ───────────────────────────────────
 * Widening the write channel is the act that lets software post into a
 * thread the customer reads, and — once MCP writes land — raise tickets
 * against a real courier account. It is the same class of act as
 * collapsing a warehouse, so it gets the same mechanism
 * (`BinCollapseChallenge`): a six-digit code mailed to the ACTOR, stored
 * hashed, attempt-capped, expiring.
 *
 * Mailing the code matters more than the code does. It proves the person
 * holding the session also holds the mailbox, which is what stops a
 * borrowed laptop from turning automation on.
 *
 * ── THE REQUEST IS RE-VALIDATED AT CONFIRM ───────────────────────────
 * A challenge is not a licence to set anything: the requested mode and
 * categories are stored on the challenge and re-checked when it is
 * confirmed. Otherwise a challenge raised for SUPERVISED could be
 * redeemed for AUTO.
 */
@Injectable()
export class CourierModeChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: CourierChannelSettingsService,
    private readonly email: EmailQueue,
    private readonly audit: AuditLogService,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Step 1 — validate the request, mint a code, mail it. */
  async request(input: {
    staffId: string;
    courierCode?: string;
    writeMode: CourierWriteMode;
    autoCategories: readonly string[];
    reason: string;
  }): Promise<{ challengeId: string; expiresAt: Date }> {
    const courierCode = input.courierCode ?? 'delhivery';

    if (input.reason.trim().length < MIN_REASON) {
      throw new BadRequestException({
        code: 'MODE_CHANGE_REASON_TOO_SHORT',
        message: `Explain why, in at least ${MIN_REASON} characters. This is written to the audit log.`,
      });
    }
    // Validate BEFORE mailing anything: a code for a change that will be
    // refused at confirm time is a wasted round trip and a confusing one.
    this.settings.assertAutoCategoriesAllowed(input.autoCategories);

    const staff = await this.prisma.client.staffUser.findUnique({
      where: { id: input.staffId },
      select: { id: true, email: true, emailDisplay: true },
    });
    if (staff === null) {
      throw new NotFoundException({ code: 'STAFF_NOT_FOUND', message: 'Staff user not found' });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

    const challenge = await this.prisma.client.courierModeChallenge.create({
      data: {
        courierCode,
        staffUserId: staff.id,
        requestedMode: input.writeMode,
        requestedCategories: [...input.autoCategories],
        codeHash: this.hash(code),
        reason: input.reason.trim(),
        expiresAt,
      },
      select: { id: true },
    });

    await this.email.enqueue({
      templateCode: 'ops.courier_mode_change_code.email',
      recipient: { type: NotificationRecipientType.STAFF, id: staff.id, email: staff.email },
      triggerEvent: 'courier.channel.mode_change_requested',
      variables: {
        staff_name: staff.emailDisplay,
        courier_code: courierCode,
        requested_mode: input.writeMode,
        code,
        reason: input.reason.trim(),
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      actorId: staff.id,
      action: 'courier.channel.mode_change_requested',
      entityType: 'courier',
      entityId: courierCode,
      severity: 'HIGH',
      metadata: {
        requestedMode: input.writeMode,
        requestedCategories: input.autoCategories,
        reason: input.reason.trim(),
      },
    });

    return { challengeId: challenge.id, expiresAt };
  }

  /** Step 2 — verify the code and apply the change. */
  async confirm(input: {
    staffId: string;
    challengeId: string;
    code: string;
  }): Promise<ChannelSettingsView> {
    const challenge = await this.prisma.client.courierModeChallenge.findUnique({
      where: { id: input.challengeId },
    });
    if (challenge === null || challenge.staffUserId !== input.staffId) {
      // Same message either way — whether a challenge exists is not
      // something an unauthorised caller should learn.
      throw new NotFoundException({
        code: 'MODE_CHALLENGE_NOT_FOUND',
        message: 'That confirmation is not valid.',
      });
    }
    if (challenge.consumedAt !== null) {
      throw new BadRequestException({
        code: 'MODE_CHALLENGE_ALREADY_USED',
        message: 'That confirmation has already been used.',
      });
    }
    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'MODE_CHALLENGE_EXPIRED',
        message: 'That confirmation has expired. Request a new one.',
      });
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException({
        code: 'MODE_CHALLENGE_TOO_MANY_ATTEMPTS',
        message: 'Too many attempts. Request a new confirmation.',
      });
    }

    // Count the attempt BEFORE comparing, so a crash mid-verify cannot
    // hand back a free guess.
    await this.prisma.client.courierModeChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });

    const supplied = Buffer.from(this.hash(input.code.trim()), 'utf8');
    const expected = Buffer.from(challenge.codeHash, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new BadRequestException({
        code: 'MODE_CHALLENGE_CODE_INVALID',
        message: 'That code is not correct.',
      });
    }

    // Claim it with a guarded update: two tabs confirming the same
    // challenge must not both apply a change.
    const { count } = await this.prisma.client.courierModeChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) {
      throw new BadRequestException({
        code: 'MODE_CHALLENGE_ALREADY_USED',
        message: 'That confirmation has already been used.',
      });
    }

    // Re-validated from the CHALLENGE, not from anything the caller sent
    // now — a challenge is not a licence to set something else.
    return this.settings.applyMode({
      courierCode: challenge.courierCode,
      writeMode: challenge.requestedMode,
      autoCategories: challenge.requestedCategories,
      staffId: input.staffId,
      reason: challenge.reason,
    });
  }
}
