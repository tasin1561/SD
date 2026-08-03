import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../config/env.service';
import { PasswordService } from '../auth-common/services/password.service';
import { JwtService, type SignedAccessToken } from '../auth-common/services/jwt.service';
import { TokenHashService } from '../auth-common/services/token-hash.service';
import {
  RefreshTokenService,
  type IssuedRefresh,
} from '../auth-common/services/refresh-token.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import { EmailQueue } from '../email/queue/email.queue';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 min
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const GENERIC_PASSWORD_RESET_MESSAGE =
  'If an account exists for that email, we sent password reset instructions.';

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface StaffLoginResult {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
  staff: { id: string; email: string; role: string };
}

export interface StaffRefreshResult {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
}

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly hashes: TokenHashService,
    private readonly refresh: RefreshTokenService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  // ---------- LOGIN ----------

  /**
   * Login: never disclose whether the email exists or the password matched.
   * The HTTP layer always returns the same generic error. The audit log,
   * however, records the truth — which is the point of the dual surface.
   */
  async login(
    input: { email: string; password: string },
    ctx: ClientContext,
  ): Promise<StaffLoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { email: normalizedEmail },
      select: { id: true, email: true, passwordHash: true, role: true, deletedAt: true },
    });

    if (!staff) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'staff.login.failure',
        entityType: 'staff_user',
        entityId: null,
        metadata: {
          attemptedEmail: normalizedEmail,
          reason: 'user_not_found',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      throw this.invalidCredentials();
    }

    if (staff.deletedAt !== null) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: staff.id,
        action: 'staff.login.failure',
        entityType: 'staff_user',
        entityId: staff.id,
        metadata: { reason: 'soft_deleted', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    const ok = await this.password.verify(staff.passwordHash, input.password);
    if (!ok) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: staff.id,
        action: 'staff.login.failure',
        entityType: 'staff_user',
        entityId: staff.id,
        metadata: { reason: 'wrong_password', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    // All checks passed — issue tokens + audit success + bump lastLoginAt
    // in a single transaction so the credentials, refresh row, and login
    // marker land together.
    return this.prisma.client.$transaction(async (tx) => {
      await tx.staffUser.update({
        where: { id: staff.id },
        data: { lastLoginAt: new Date() },
      });

      const refresh = await this.refresh.issue({
        subject: 'staff',
        userId: staff.id,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        tx,
      });
      const accessToken = this.jwt.signStaffAccess({ subject: staff.id, role: staff.role });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staff.id,
          action: 'staff.login.success',
          entityType: 'staff_user',
          entityId: staff.id,
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            jti: accessToken.jti,
            refreshTokenId: refresh.recordId,
          },
        },
        tx,
      );

      return {
        accessToken,
        refresh,
        staff: { id: staff.id, email: staff.email, role: staff.role },
      };
    });
  }

  // ---------- REFRESH ----------

  async rotateRefresh(
    input: { plaintext: string },
    ctx: ClientContext,
  ): Promise<StaffRefreshResult> {
    if (!input.plaintext) throw this.invalidRefresh();

    const { userId, issued } = await this.refresh.rotate({
      subject: 'staff',
      presentedToken: input.plaintext,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!staff) {
      // The user was deleted between issuing and refreshing — revoke the
      // newly minted token immediately so the cookie is dead.
      await this.refresh.revokeByPlaintext('staff', issued.token);
      throw this.invalidRefresh();
    }

    const accessToken = this.jwt.signStaffAccess({ subject: staff.id, role: staff.role });
    return { accessToken, refresh: issued };
  }

  // ---------- LOGOUT ----------

  async logout(input: { refreshPlaintext: string | null; staffId: string | null }): Promise<void> {
    if (input.refreshPlaintext) {
      await this.refresh.revokeByPlaintext('staff', input.refreshPlaintext);
    }
    if (input.staffId) {
      await this.audit.log({
        actorType: ActorType.STAFF,
        staffUserId: input.staffId,
        action: 'staff.logout.success',
        entityType: 'staff_user',
        entityId: input.staffId,
      });
    }
  }

  async logoutAll(staffId: string): Promise<{ revokedCount: number }> {
    const revokedCount = await this.refresh.revokeAllForUser({ subject: 'staff', userId: staffId });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action: 'staff.logout_all.success',
      entityType: 'staff_user',
      entityId: staffId,
      metadata: { revokedCount },
    });
    return { revokedCount };
  }

  // ---------- PASSWORD RESET ----------

  /**
   * Always returns the same generic 200 message regardless of whether the
   * email exists. Audit log captures the truth.
   */
  async requestPasswordReset(
    input: { email: string },
    ctx: ClientContext,
  ): Promise<{ message: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const staff = await this.prisma.client.staffUser.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: { id: true, email: true, emailDisplay: true },
    });

    if (!staff) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'staff.password_reset.requested',
        entityType: 'staff_user',
        entityId: null,
        metadata: {
          attemptedEmail: normalizedEmail,
          outcome: 'unknown_email',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { message: GENERIC_PASSWORD_RESET_MESSAGE };
    }

    const plaintext = this.hashes.generatePasswordResetToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.client.staffPasswordResetToken.create({
      data: {
        staffUserId: staff.id,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress ?? null,
      },
    });

    await this.email.enqueue({
      templateCode: 'staff.password_reset.email',
      recipient: { type: NotificationRecipientType.STAFF, id: staff.id, email: staff.email },
      variables: {
        contact_name: staff.emailDisplay,
        reset_url: `${this.env.adminAppUrl}/auth/reset-password?token=${plaintext}`,
        expires_minutes: 30,
      },
      triggerEvent: 'staff.password_reset.requested',
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.password_reset.requested',
      entityType: 'staff_user',
      entityId: staff.id,
      metadata: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return { message: GENERIC_PASSWORD_RESET_MESSAGE };
  }

  async confirmPasswordReset(
    input: { token: string; newPassword: string },
    ctx: ClientContext,
  ): Promise<{ ok: true }> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const row = await this.prisma.client.staffPasswordResetToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        staffUserId: true,
        expiresAt: true,
        usedAt: true,
        staffUser: { select: { id: true, deletedAt: true } },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.staffUser ||
      row.staffUser.deletedAt !== null
    ) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Reset link is invalid or has expired',
      });
    }

    const newHash = await this.password.hash(input.newPassword);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffUser.update({
        where: { id: row.staffUserId },
        data: { passwordHash: newHash },
      });
      await tx.staffPasswordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      // Revoke every active refresh session — password change forces re-login.
      await tx.staffRefreshToken.updateMany({
        where: { staffUserId: row.staffUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: row.staffUserId,
          action: 'staff.password_reset.completed',
          entityType: 'staff_user',
          entityId: row.staffUserId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        },
        tx,
      );
    });

    // The account holder is told, always.
    //
    // A password change they did not make is indistinguishable from a
    // takeover until somebody tells them — and every session was just
    // revoked, so at this moment whoever set the password holds the only
    // working credential. This email is the only thing standing between
    // that and a silent, permanent loss of the account.
    //
    // Best-effort AFTER the commit: the change is done and correct, and
    // failing the request now would leave the user believing their reset
    // did not work while it silently did. A send failure is logged at
    // ERROR because a security notice nobody received is worth knowing
    // about.
    try {
      const owner = await this.prisma.client.staffUser.findUnique({
        where: { id: row.staffUserId },
        select: { email: true, emailDisplay: true },
      });
      if (owner) {
        await this.email.enqueue({
          templateCode: 'staff.password_changed.email',
          recipient: {
            type: NotificationRecipientType.STAFF,
            id: row.staffUserId,
            email: owner.email,
          },
          variables: {
            email: owner.emailDisplay,
            changed_at: new Date().toUTCString(),
            login_url: `${this.env.adminAppUrl}/login`,
            support_email: this.env.supportEmail,
            ip_address: ctx.ipAddress ?? 'unknown',
          },
          triggerEvent: 'staff.password_reset.completed',
        });
      }
    } catch (e) {
      this.logger.error(
        { staffUserId: row.staffUserId, err: (e as Error).message },
        'Staff password-changed notice could not be queued; the password WAS changed',
      );
    }

    return { ok: true };
  }

  // ---------- EMAIL VERIFICATION ----------

  /** Authenticated — issued to the currently logged-in staff for their current email. */
  async requestEmailVerification(staffId: string, ctx: ClientContext): Promise<{ ok: true }> {
    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: staffId, deletedAt: null },
      select: { id: true, email: true, emailDisplay: true, emailVerifiedAt: true },
    });
    if (!staff) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Staff session no longer valid',
      });
    }

    if (staff.emailVerifiedAt !== null) {
      throw new ConflictException({
        code: 'ALREADY_VERIFIED',
        message: 'Email is already verified',
      });
    }

    const plaintext = this.hashes.generateEmailVerificationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await this.prisma.client.staffEmailVerificationToken.create({
      data: {
        staffUserId: staff.id,
        tokenHash,
        email: staff.email,
        expiresAt,
      },
    });

    await this.email.enqueue({
      templateCode: 'staff.email_verification.email',
      recipient: { type: NotificationRecipientType.STAFF, id: staff.id, email: staff.email },
      variables: {
        contact_name: staff.emailDisplay,
        verify_url: `${this.env.adminAppUrl}/auth/verify-email?token=${plaintext}`,
        expires_hours: 24,
      },
      triggerEvent: 'staff.email_verification.requested',
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staff.id,
      action: 'staff.email_verification.requested',
      entityType: 'staff_user',
      entityId: staff.id,
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: staff.email },
    });

    return { ok: true };
  }

  async confirmEmailVerification(
    input: { token: string },
    ctx: ClientContext,
  ): Promise<{ ok: true }> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const row = await this.prisma.client.staffEmailVerificationToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        staffUserId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        staffUser: { select: { id: true, email: true, deletedAt: true } },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.staffUser ||
      row.staffUser.deletedAt !== null ||
      row.staffUser.email !== row.email
    ) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Verification link is invalid or has expired',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.staffUser.update({
        where: { id: row.staffUserId },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.staffEmailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: row.staffUserId,
          action: 'staff.email_verification.completed',
          entityType: 'staff_user',
          entityId: row.staffUserId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: row.email },
        },
        tx,
      );
    });

    return { ok: true };
  }

  // ---------- ME ----------

  async getMe(staffId: string): Promise<{
    id: string;
    email: string;
    emailDisplay: string;
    role: string;
    emailVerifiedAt: Date | null;
    lastLoginAt: Date | null;
    createdAt: Date;
  }> {
    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: staffId, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        role: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    if (!staff) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Staff session no longer valid',
      });
    }
    return staff;
  }

  // ---------- internal ----------

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials',
    });
  }
  private invalidRefresh(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH',
      message: 'Invalid or expired refresh token',
    });
  }
}
