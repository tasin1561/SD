import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ActorType, Currency, NotificationRecipientType, SellerStatus } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../config/env.service';
import { PasswordService } from '../auth-common/services/password.service';
import { JwtService, type SignedAccessToken } from '../auth-common/services/jwt.service';
import { TokenHashService } from '../auth-common/services/token-hash.service';
import { RefreshTokenService, type IssuedRefresh } from '../auth-common/services/refresh-token.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import { EmailQueue } from '../email/queue/email.queue';
import type { SellerRegisterViaInvitationDto } from './dto/register-via-invitation.dto';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const GENERIC_PASSWORD_RESET_MESSAGE =
  'If an account exists for that email, we sent password reset instructions.';
const ACCOUNT_NOT_ACTIVE_MESSAGE = 'Account not active. Contact support.';

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface SellerLoginResult {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
  seller: { id: string; email: string; status: SellerStatus };
}

export interface SellerRefreshResult {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
}

export interface SellerRegistrationResult {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
  seller: { id: string; email: string; status: SellerStatus };
}

export interface SellerMe {
  id: string;
  email: string;
  emailDisplay: string;
  companyName: string;
  contactPersonName: string;
  phone: string;
  whatsapp: string | null;
  status: SellerStatus;
  approvedAt: Date | null;
  displayCurrency: Currency;
  displayLanguage: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class SellerAuthService {
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

  // ---------- REGISTER VIA INVITATION ----------

  /**
   * Consumes a seller_invitations.token, creates the seller with
   * status=APPROVED directly (per Phase 1A design — the invitation IS the
   * approval gate; no two-step vetting), sets the password, marks the
   * invitation used, and audits the registration.
   *
   * The whole operation runs in a transaction so the invitation cannot be
   * consumed twice via concurrent requests with the same token.
   */
  async registerViaInvitation(
    input: SellerRegisterViaInvitationDto,
    ctx: ClientContext,
  ): Promise<SellerRegistrationResult> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const invitation = await this.prisma.client.sellerInvitation.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
        email: true,
        invitedById: true,
        sellerId: true,
        expiresAt: true,
        usedAt: true,
        deletedAt: true,
      },
    });

    if (
      !invitation ||
      invitation.deletedAt !== null ||
      invitation.usedAt !== null ||
      invitation.sellerId !== null ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException({
        code: 'INVALID_INVITATION',
        message: 'Invitation is invalid, expired, or already used',
      });
    }

    const normalizedEmail = invitation.email.trim().toLowerCase();

    // Make sure a seller with this email doesn't already exist (paranoia —
    // the invitation flow shouldn't be issued for an existing account, but
    // race-conditions during ops fixes happen).
    const existing = await this.prisma.client.seller.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A seller account already exists for this email',
      });
    }

    const passwordHash = await this.password.hash(input.password);
    const now = new Date();

    const { seller, refresh, accessToken } = await this.prisma.client.$transaction(async (tx) => {
      // Re-check inside the tx — protects against double-consume.
      const reChecked = await tx.sellerInvitation.findUnique({
        where: { id: invitation.id },
        select: { id: true, usedAt: true, sellerId: true },
      });
      if (!reChecked || reChecked.usedAt !== null || reChecked.sellerId !== null) {
        throw new BadRequestException({
          code: 'INVALID_INVITATION',
          message: 'Invitation has already been used',
        });
      }

      const createdSeller = await tx.seller.create({
        data: {
          email: normalizedEmail,
          emailDisplay: invitation.email,
          passwordHash,
          companyName: input.companyName,
          contactPersonName: input.contactPersonName,
          phone: input.phone,
          whatsapp: input.whatsapp ?? null,
          status: SellerStatus.APPROVED,
          approvedAt: now,
          approvedById: invitation.invitedById,
          displayCurrency: (input.displayCurrency ?? 'INR') as Currency,
          displayLanguage: input.displayLanguage ?? 'en',
        },
        select: { id: true, email: true, status: true },
      });

      await tx.sellerInvitation.update({
        where: { id: invitation.id },
        data: { usedAt: now, sellerId: createdSeller.id },
      });

      const issued = await this.refresh.issue({
        subject: 'seller',
        userId: createdSeller.id,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        tx,
      });
      const access = this.jwt.signSellerAccess({
        subject: createdSeller.id,
        status: createdSeller.status,
      });

      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId: createdSeller.id,
          action: 'seller.registered_via_invitation',
          entityType: 'seller',
          entityId: createdSeller.id,
          metadata: {
            invitationId: invitation.id,
            invitedById: invitation.invitedById,
            email: createdSeller.email,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        },
        tx,
      );

      return { seller: createdSeller, refresh: issued, accessToken: access };
    });

    // Welcome email — non-fatal if the enqueue throws (shouldn't, but the
    // registration must not roll back over a queue glitch).
    try {
      await this.email.enqueue({
        templateCode: 'seller.welcome.email',
        recipient: { type: NotificationRecipientType.SELLER, id: seller.id, email: seller.email },
        variables: {
          contact_name: input.contactPersonName,
          company_name: input.companyName,
        },
        triggerEvent: 'seller.registered_via_invitation',
      });
    } catch {
      // Audit will show the registration succeeded; the welcome email is
      // operational, not legally significant.
    }

    return { accessToken, refresh, seller };
  }

  // ---------- LOGIN ----------

  async login(input: { email: string; password: string }, ctx: ClientContext): Promise<SellerLoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const seller = await this.prisma.client.seller.findFirst({
      where: { email: normalizedEmail },
      select: { id: true, email: true, passwordHash: true, status: true, deletedAt: true },
    });

    if (!seller) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'seller.login.failure',
        entityType: 'seller',
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

    if (seller.deletedAt !== null) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        action: 'seller.login.failure',
        entityType: 'seller',
        entityId: seller.id,
        metadata: { reason: 'soft_deleted', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    const ok = await this.password.verify(seller.passwordHash, input.password);
    if (!ok) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        action: 'seller.login.failure',
        entityType: 'seller',
        entityId: seller.id,
        metadata: { reason: 'wrong_password', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    // Status check: only APPROVED sellers can log in. PENDING/REJECTED/
    // SUSPENDED all share a generic 403 (we DO disclose the "not active"
    // state — it's the desired UX, distinct from "invalid credentials").
    if (seller.status !== SellerStatus.APPROVED) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        action: 'seller.login.failure',
        entityType: 'seller',
        entityId: seller.id,
        metadata: {
          reason: 'status_not_active',
          status: seller.status,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: ACCOUNT_NOT_ACTIVE_MESSAGE,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const refresh = await this.refresh.issue({
        subject: 'seller',
        userId: seller.id,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        tx,
      });
      const accessToken = this.jwt.signSellerAccess({ subject: seller.id, status: seller.status });

      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId: seller.id,
          action: 'seller.login.success',
          entityType: 'seller',
          entityId: seller.id,
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
        seller: { id: seller.id, email: seller.email, status: seller.status },
      };
    });
  }

  // ---------- REFRESH ----------

  async rotateRefresh(input: { plaintext: string }, ctx: ClientContext): Promise<SellerRefreshResult> {
    if (!input.plaintext) throw this.invalidRefresh();

    const { userId, issued } = await this.refresh.rotate({
      subject: 'seller',
      presentedToken: input.plaintext,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!seller || seller.status !== SellerStatus.APPROVED) {
      // Refresh issued, but the underlying seller is gone or no longer
      // active. Revoke the new token immediately so the cookie is dead.
      await this.refresh.revokeByPlaintext('seller', issued.token);
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: ACCOUNT_NOT_ACTIVE_MESSAGE,
      });
    }

    const accessToken = this.jwt.signSellerAccess({ subject: seller.id, status: seller.status });
    return { accessToken, refresh: issued };
  }

  // ---------- LOGOUT ----------

  async logout(input: { refreshPlaintext: string | null; sellerId: string | null }): Promise<void> {
    if (input.refreshPlaintext) {
      await this.refresh.revokeByPlaintext('seller', input.refreshPlaintext);
    }
    if (input.sellerId) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: input.sellerId,
        action: 'seller.logout.success',
        entityType: 'seller',
        entityId: input.sellerId,
      });
    }
  }

  async logoutAll(sellerId: string): Promise<{ revokedCount: number }> {
    const revokedCount = await this.refresh.revokeAllForUser({ subject: 'seller', userId: sellerId });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.logout_all.success',
      entityType: 'seller',
      entityId: sellerId,
      metadata: { revokedCount },
    });
    return { revokedCount };
  }

  // ---------- PASSWORD RESET ----------

  async requestPasswordReset(input: { email: string }, ctx: ClientContext): Promise<{ message: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const seller = await this.prisma.client.seller.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: { id: true, email: true, contactPersonName: true, status: true },
    });

    if (!seller) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'seller.password_reset.requested',
        entityType: 'seller',
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

    // Sellers with non-APPROVED status can still request password resets
    // (e.g., suspended sellers need to recover). Audit captures the status.
    const plaintext = this.hashes.generatePasswordResetToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.client.sellerPasswordResetToken.create({
      data: {
        sellerId: seller.id,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress ?? null,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.password_reset.email',
      recipient: { type: NotificationRecipientType.SELLER, id: seller.id, email: seller.email },
      variables: {
        contact_name: seller.contactPersonName,
        reset_url: `${this.env.sellerAppUrl}/auth/reset-password?token=${plaintext}`,
        expires_minutes: 30,
      },
      triggerEvent: 'seller.password_reset.requested',
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: seller.id,
      action: 'seller.password_reset.requested',
      entityType: 'seller',
      entityId: seller.id,
      metadata: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: expiresAt.toISOString(),
        status: seller.status,
      },
    });

    return { message: GENERIC_PASSWORD_RESET_MESSAGE };
  }

  async confirmPasswordReset(
    input: { token: string; newPassword: string },
    ctx: ClientContext,
  ): Promise<{ ok: true }> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const row = await this.prisma.client.sellerPasswordResetToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        sellerId: true,
        expiresAt: true,
        usedAt: true,
        seller: { select: { id: true, deletedAt: true } },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.seller ||
      row.seller.deletedAt !== null
    ) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Reset link is invalid or has expired',
      });
    }

    const newHash = await this.password.hash(input.newPassword);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: row.sellerId },
        data: { passwordHash: newHash },
      });
      await tx.sellerPasswordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await tx.sellerRefreshToken.updateMany({
        where: { sellerId: row.sellerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId: row.sellerId,
          action: 'seller.password_reset.completed',
          entityType: 'seller',
          entityId: row.sellerId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        },
        tx,
      );
    });

    return { ok: true };
  }

  // ---------- EMAIL VERIFICATION ----------

  async requestEmailVerification(sellerId: string, ctx: ClientContext): Promise<{ ok: true }> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: {
        id: true,
        email: true,
        contactPersonName: true,
        emailVerifiedAt: true,
      },
    });
    if (!seller) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Seller session no longer valid' });
    }
    if (seller.emailVerifiedAt !== null) {
      throw new ConflictException({
        code: 'ALREADY_VERIFIED',
        message: 'Email is already verified',
      });
    }

    const plaintext = this.hashes.generateEmailVerificationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);

    await this.prisma.client.sellerEmailVerificationToken.create({
      data: {
        sellerId: seller.id,
        tokenHash,
        email: seller.email,
        expiresAt,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.email_verification.email',
      recipient: { type: NotificationRecipientType.SELLER, id: seller.id, email: seller.email },
      variables: {
        contact_name: seller.contactPersonName,
        verify_url: `${this.env.sellerAppUrl}/auth/verify-email?token=${plaintext}`,
        expires_hours: 24,
      },
      triggerEvent: 'seller.email_verification.requested',
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: seller.id,
      action: 'seller.email_verification.requested',
      entityType: 'seller',
      entityId: seller.id,
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: seller.email },
    });

    return { ok: true };
  }

  async confirmEmailVerification(input: { token: string }, ctx: ClientContext): Promise<{ ok: true }> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const row = await this.prisma.client.sellerEmailVerificationToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        sellerId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        seller: { select: { id: true, email: true, deletedAt: true } },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.seller ||
      row.seller.deletedAt !== null ||
      row.seller.email !== row.email
    ) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Verification link is invalid or has expired',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: row.sellerId },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.sellerEmailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId: row.sellerId,
          action: 'seller.email_verification.completed',
          entityType: 'seller',
          entityId: row.sellerId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: row.email },
        },
        tx,
      );
    });

    return { ok: true };
  }

  // ---------- ME ----------

  async getMe(sellerId: string): Promise<SellerMe> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        companyName: true,
        contactPersonName: true,
        phone: true,
        whatsapp: true,
        status: true,
        approvedAt: true,
        displayCurrency: true,
        displayLanguage: true,
        countryCode: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });
    if (!seller) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Seller session no longer valid' });
    }
    return seller;
  }

  // ---------- internal ----------

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
  }
  private invalidRefresh(): UnauthorizedException {
    return new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Invalid or expired refresh token' });
  }
}
