import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  NotificationRecipientType,
  OnboardingStepActor,
  SellerOnboardingStep,
  SellerStatus,
  SellerUserRole,
} from '@skydrop/db';
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
import { FxRateService } from '../fx/services/fx-rate.service';
import { EmailQueue } from '../email/queue/email.queue';
import { SellerOnboardingService } from '../seller-onboarding/services/seller-onboarding.service';
import { SellerNotificationPreferenceService } from '../seller-notification-preference/services/seller-notification-preference.service';
import type { SellerRegisterViaInvitationDto } from './dto/register-via-invitation.dto';
import { provisionDefaultSellerRoles } from '../../common/auth/seller-role-provisioning';
import { ALL_SELLER_PERMISSION_KEYS } from '../../common/auth/seller-permissions';
import { generateSellerInitials } from './util/seller-initials';

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
  /** `seller_roles.key` — the role held, including ones the company made. */
  roleKey: string;
  roleName: string;
  /** What the seller app hides things by. FE-2: rendering, not permission. */
  permissions: readonly string[];
  // id is the COMPANY id (back-compat with all existing consumers).
  id: string;
  // email is the AUTHENTICATED USER's email (Phase 1B — the person who
  // signed in), not the company contact email.
  email: string;
  emailDisplay: string;
  companyName: string;
  contactPersonName: string;
  phone: string;
  whatsapp: string | null;
  status: SellerStatus;
  approvedAt: Date | null;
  displayCurrency: Currency;
  displayFxRate: string | null;
  displayLanguage: string;
  countryCode: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  // Phase 1B — the signed-in user identity.
  sellerUserId: string;
  role: SellerUserRole;
  fullName: string;
  /** The company's short code — shown as a fixed prefix on recipient
   *  names. Read-only to the seller; staff-editable only. */
  initials: string | null;
}

@Injectable()
export class SellerAuthService {
  private readonly logger = new Logger(SellerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly hashes: TokenHashService,
    private readonly refresh: RefreshTokenService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly onboarding: SellerOnboardingService,
    private readonly notificationPreferences: SellerNotificationPreferenceService,
    private readonly fx: FxRateService,
  ) {}

  /**
   * Rupees to the seller's display currency.
   *
   * Never throws: a missing rate returns null and the app keeps showing
   * rupees. Sign-in must not depend on the FX table having a row — an
   * unresolvable rate is a display inconvenience, not a reason a seller
   * cannot reach their account.
   */
  private async resolveDisplayFxRate(display: Currency): Promise<string | null> {
    if (display === Currency.INR) return null;
    try {
      const rate = await this.fx.getRate(Currency.INR, display);
      return rate.toString();
    } catch {
      return null;
    }
  }

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

      // The operations short code, derived once here and owned by staff
      // thereafter. Generated INSIDE the registration tx so a company can
      // never exist without one; uniqueness is checked against the same
      // transaction, and the unique index is the real guard if two
      // signups race.
      const initials = await generateSellerInitials(
        input.companyName,
        async (candidate) => (await tx.seller.count({ where: { initials: candidate } })) > 0,
      );

      const createdSeller = await tx.seller.create({
        data: {
          email: normalizedEmail,
          emailDisplay: invitation.email,
          passwordHash,
          companyName: input.companyName,
          initials,
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

      // The company's six starting roles, BEFORE its first login —
      // `seller_users.role_id` is NOT NULL, so a company without roles
      // is a company whose owner row cannot be created.
      const { ownerRoleId } = await provisionDefaultSellerRoles(tx, createdSeller.id);

      // Phase 1B — the OWNER SellerUser row carries the auth credentials
      // for the new RBAC flow. Same tx so the company + owner come up
      // together or not at all.
      const createdOwner = await tx.sellerUser.create({
        data: {
          sellerId: createdSeller.id,
          roleId: ownerRoleId,
          email: normalizedEmail,
          emailDisplay: invitation.email,
          passwordHash,
          fullName: input.contactPersonName,
          role: 'OWNER',
          emailVerifiedAt: now,
        },
        select: { id: true, role: true },
      });

      await tx.sellerInvitation.update({
        where: { id: invitation.id },
        data: { usedAt: now, sellerId: createdSeller.id },
      });

      const issued = await this.refresh.issue({
        subject: 'seller',
        userId: createdOwner.id,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        tx,
      });
      const access = this.jwt.signSellerAccess({
        subject: createdOwner.id,
        status: createdSeller.status,
        sellerId: createdSeller.id,
        role: createdOwner.role,
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

      // Initialize onboarding rows (8 steps; registration + company-info
      // are auto-marked complete). Must run inside the registration tx
      // so a rollback doesn't orphan onboarding rows.
      await this.onboarding.initializeProgress(createdSeller.id, tx);

      // EMAIL_VERIFIED is satisfied by construction here: reaching this
      // code required consuming a token that was emailed to this exact
      // address, which is why the OWNER row above is created with
      // `emailVerifiedAt: now`. Marking the onboarding step in the same
      // breath keeps the two representations of "email is verified" in
      // agreement.
      //
      // Without this, onboarding was UNCOMPLETABLE for every
      // invite-registered seller: `confirmEmailVerification` is the only
      // other place that marks this step, and the only way to obtain a
      // confirmation token — `requestEmailVerification` — permanently
      // 409s ALREADY_VERIFIED once `emailVerifiedAt` is set. So the step
      // could never be reached and `onboarding.isComplete` could never
      // become true.
      await this.onboarding.markStepComplete(
        createdSeller.id,
        SellerOnboardingStep.EMAIL_VERIFIED,
        OnboardingStepActor.SYSTEM,
        { email: normalizedEmail, via: 'invitation-registration' },
        tx,
      );

      // Pre-seed the 7 notification-preference rows with Phase 1A defaults.
      await this.notificationPreferences.seedDefaults(createdSeller.id, tx);

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
          seller_app_url: this.env.sellerAppUrl,
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

  async login(
    input: { email: string; password: string },
    ctx: ClientContext,
  ): Promise<SellerLoginResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Phase 1B RBAC — look up the SellerUser; the parent Seller is
    // joined for the status recheck. The legacy sellers.email/password
    // columns are retained for back-compat but no longer used here.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        deletedAt: true,
        seller: {
          select: { id: true, status: true, deletedAt: true },
        },
      },
    });

    if (!user) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'seller.login.failure',
        entityType: 'seller_user',
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

    const seller = {
      id: user.seller.id,
      email: user.email,
      status: user.seller.status,
      deletedAt: user.seller.deletedAt,
    };

    if (user.deletedAt !== null || seller.deletedAt !== null) {
      await this.audit.log({
        actorType: ActorType.SELLER,
        sellerId: seller.id,
        action: 'seller.login.failure',
        entityType: 'seller_user',
        entityId: user.id,
        metadata: { reason: 'soft_deleted', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    const ok = await this.password.verify(user.passwordHash, input.password);
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

    // Status check: APPROVED and SUSPENDED sellers can log in (SUSPENDED
    // is read-only — write endpoints gate further on the seller-jwt guard).
    // PENDING/REJECTED return a generic 403 (we DO disclose the "not active"
    // state — it's the desired UX, distinct from "invalid credentials").
    if (seller.status !== SellerStatus.APPROVED && seller.status !== SellerStatus.SUSPENDED) {
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
        userId: user.id,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        tx,
      });
      const accessToken = this.jwt.signSellerAccess({
        subject: user.id,
        status: seller.status,
        sellerId: seller.id,
        role: user.role,
      });

      await tx.sellerUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

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

  async rotateRefresh(
    input: { plaintext: string },
    ctx: ClientContext,
  ): Promise<SellerRefreshResult> {
    if (!input.plaintext) throw this.invalidRefresh();

    const { userId, issued } = await this.refresh.rotate({
      subject: 'seller',
      presentedToken: input.plaintext,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    // Phase 1B RBAC — userId is the SellerUser id (we updated the
    // issue() callsites). Look up the user + join the parent Seller.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        role: true,
        seller: { select: { id: true, status: true, deletedAt: true } },
      },
    });
    if (
      !user ||
      user.seller.deletedAt !== null ||
      (user.seller.status !== SellerStatus.APPROVED &&
        user.seller.status !== SellerStatus.SUSPENDED)
    ) {
      await this.refresh.revokeByPlaintext('seller', issued.token);
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message: ACCOUNT_NOT_ACTIVE_MESSAGE,
      });
    }

    const accessToken = this.jwt.signSellerAccess({
      subject: user.id,
      status: user.seller.status,
      sellerId: user.seller.id,
      role: user.role,
    });
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
    const revokedCount = await this.refresh.revokeAllForUser({
      subject: 'seller',
      userId: sellerId,
    });
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

  async requestPasswordReset(
    input: { email: string },
    ctx: ClientContext,
  ): Promise<{ message: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Phase 1B — password reset is now keyed on the SellerUser (the
    // signing-in person), not the Seller (the company). Any team
    // member can request a reset for THEIR account.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        fullName: true,
        seller: { select: { id: true, status: true, deletedAt: true } },
      },
    });

    if (!user || user.seller.deletedAt !== null) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'seller.password_reset.requested',
        entityType: 'seller_user',
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
        sellerUserId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress ?? null,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.password_reset.email',
      recipient: { type: NotificationRecipientType.SELLER, id: user.seller.id, email: user.email },
      variables: {
        contact_name: user.fullName,
        reset_url: `${this.env.sellerAppUrl}/auth/reset-password?token=${plaintext}`,
        expires_minutes: 30,
      },
      triggerEvent: 'seller.password_reset.requested',
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: user.seller.id,
      action: 'seller.password_reset.requested',
      entityType: 'seller_user',
      entityId: user.id,
      metadata: {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        expiresAt: expiresAt.toISOString(),
        status: user.seller.status,
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
        sellerUserId: true,
        expiresAt: true,
        usedAt: true,
        sellerUser: {
          select: {
            id: true,
            deletedAt: true,
            seller: { select: { id: true, deletedAt: true } },
          },
        },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.sellerUser ||
      row.sellerUser.deletedAt !== null ||
      row.sellerUser.seller.deletedAt !== null
    ) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Reset link is invalid or has expired',
      });
    }

    const newHash = await this.password.hash(input.newPassword);
    const sellerId = row.sellerUser.seller.id;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.sellerUser.update({
        where: { id: row.sellerUserId },
        data: { passwordHash: newHash },
      });
      await tx.sellerPasswordResetToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await tx.sellerRefreshToken.updateMany({
        where: { sellerUserId: row.sellerUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.password_reset.completed',
          entityType: 'seller_user',
          entityId: row.sellerUserId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        },
        tx,
      );
    });

    // Tell the owner, always. See the staff equivalent for the full
    // reasoning; the stake is higher here — a seller account holds their
    // stock and their wallet.
    //
    // Best-effort after the commit: the change is done, and failing now
    // would tell someone their reset did not work when it silently did.
    try {
      const owner = await this.prisma.client.sellerUser.findUnique({
        where: { id: row.sellerUserId },
        select: { email: true, fullName: true },
      });
      if (owner) {
        await this.email.enqueue({
          templateCode: 'seller.password_changed.email',
          recipient: {
            type: NotificationRecipientType.SELLER,
            id: row.sellerUserId,
            email: owner.email,
          },
          variables: {
            email: owner.email,
            contact_name: owner.fullName,
            changed_at: new Date().toUTCString(),
            login_url: `${this.env.sellerAppUrl}/login`,
            support_email: this.env.supportEmail,
            ip_address: ctx.ipAddress ?? 'unknown',
          },
          triggerEvent: 'seller.password_reset.completed',
        });
      }
    } catch (e) {
      this.logger.error(
        { sellerUserId: row.sellerUserId, err: (e as Error).message },
        'Seller password-changed notice could not be queued; the password WAS changed',
      );
    }

    return { ok: true };
  }

  // ---------- EMAIL VERIFICATION ----------

  async requestEmailVerification(sellerUserId: string, ctx: ClientContext): Promise<{ ok: true }> {
    // Phase 1B — email verification is per-user, not per-company.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: sellerUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        seller: { select: { id: true, deletedAt: true } },
      },
    });
    if (!user || user.seller.deletedAt !== null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Seller session no longer valid',
      });
    }
    if (user.emailVerifiedAt !== null) {
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
        sellerUserId: user.id,
        tokenHash,
        email: user.email,
        expiresAt,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.email_verification.email',
      recipient: { type: NotificationRecipientType.SELLER, id: user.seller.id, email: user.email },
      variables: {
        contact_name: user.fullName,
        verify_url: `${this.env.sellerAppUrl}/auth/verify-email?token=${plaintext}`,
        expires_hours: 24,
      },
      triggerEvent: 'seller.email_verification.requested',
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: user.seller.id,
      action: 'seller.email_verification.requested',
      entityType: 'seller_user',
      entityId: user.id,
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: user.email },
    });

    return { ok: true };
  }

  async confirmEmailVerification(
    input: { token: string },
    ctx: ClientContext,
  ): Promise<{ ok: true }> {
    const tokenHash = this.hashes.sha256Hex(input.token);

    const row = await this.prisma.client.sellerEmailVerificationToken.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        sellerUserId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        sellerUser: {
          select: {
            id: true,
            email: true,
            deletedAt: true,
            seller: { select: { id: true, deletedAt: true } },
          },
        },
      },
    });

    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.sellerUser ||
      row.sellerUser.deletedAt !== null ||
      row.sellerUser.seller.deletedAt !== null ||
      row.sellerUser.email !== row.email
    ) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Verification link is invalid or has expired',
      });
    }

    const sellerId = row.sellerUser.seller.id;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.sellerUser.update({
        where: { id: row.sellerUserId },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.sellerEmailVerificationToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'seller.email_verification.completed',
          entityType: 'seller_user',
          entityId: row.sellerUserId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, email: row.email },
        },
        tx,
      );
      await this.onboarding.markStepComplete(
        sellerId,
        SellerOnboardingStep.EMAIL_VERIFIED,
        OnboardingStepActor.SYSTEM,
        { email: row.email },
        tx,
      );
    });

    return { ok: true };
  }

  // ---------- ME ----------

  async getMe(sellerUserId: string): Promise<SellerMe> {
    // Phase 1B: the auth path identifies a SellerUser (the person who
    // signed in). The SellerMe projection still mirrors the COMPANY
    // shape downstream FE expects — companyName/phone/etc. come from
    // the parent Seller; the user's own email/role/fullName are
    // surfaced alongside for the team-aware UI.
    const user = await this.prisma.client.sellerUser.findFirst({
      where: { id: sellerUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        fullName: true,
        role: true,
        emailVerifiedAt: true,
        sellerRole: {
          select: {
            key: true,
            name: true,
            isOwner: true,
            deletedAt: true,
            permissions: { select: { permission: true } },
          },
        },
        seller: {
          select: {
            id: true,
            companyName: true,
            contactPersonName: true,
            phone: true,
            whatsapp: true,
            status: true,
            approvedAt: true,
            displayCurrency: true,
            displayLanguage: true,
            countryCode: true,
            createdAt: true,
            // READ-ONLY, and the ONLY seller-facing read of this column
            // (see seller-initials-not-exposed.spec.ts). The order form
            // shows it as a fixed prefix on the recipient name, the way
            // it shows +91 on the phone — so it has to be legible. There
            // is still no seller WRITE path: the code goes on paperwork
            // that already exists in the world, so only staff move it.
            initials: true,
          },
        },
      },
    });
    if (!user || user.sellerRole.deletedAt !== null) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Seller session no longer valid',
      });
    }
    return {
      id: user.seller.id,
      email: user.email,
      emailDisplay: user.emailDisplay,
      companyName: user.seller.companyName,
      initials: user.seller.initials,
      contactPersonName: user.seller.contactPersonName,
      phone: user.seller.phone,
      whatsapp: user.seller.whatsapp,
      status: user.seller.status,
      approvedAt: user.seller.approvedAt,
      displayCurrency: user.seller.displayCurrency,
      /**
       * Rupees to the seller's display currency, so the app can show
       * every figure in the money they think in. Null when they already
       * work in rupees, or when no rate exists — and null means "keep
       * showing rupees", because a wrong rate is worse than the wrong
       * currency.
       *
       * Carried on /me rather than fetched per page: the identity is
       * already resolved server-side before first paint, so the app
       * never renders rupees and then flips them to taka.
       */
      displayFxRate: await this.resolveDisplayFxRate(user.seller.displayCurrency),
      displayLanguage: user.seller.displayLanguage,
      countryCode: user.seller.countryCode,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.seller.createdAt,
      sellerUserId: user.id,
      role: user.role,
      roleKey: user.sellerRole.key,
      roleName: user.sellerRole.name,
      // What the UI hides things by. Resolved from the role rather than
      // read off the token, so an owner editing a role takes effect on
      // the next page load instead of whenever the access token expires.
      // FE-2 still holds: this decides what is RENDERED, never what is
      // permitted — the API refuses regardless.
      permissions: user.sellerRole.isOwner
        ? ALL_SELLER_PERMISSION_KEYS
        : user.sellerRole.permissions.map((p) => p.permission),
      fullName: user.fullName,
    };
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
