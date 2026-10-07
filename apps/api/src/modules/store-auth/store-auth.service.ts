import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ActorType,
  NotificationRecipientType,
  type ResellerStoreStatus,
  type ResellerWalletManager,
} from '@skydrop/db';
import { EnvService } from '../../config/env.service';
import {
  ImpersonationBannerService,
  type ImpersonationBannerContext,
} from '../../common/impersonation/impersonation-banner';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../infrastructure/spaces/spaces.service';
import { ALL_STORE_PERMISSION_KEYS } from '../../common/auth/store-permissions';
import { resolveRoles } from '../../common/auth/role-union';
import { rolesOnCreate } from '../../common/auth/role-assignment';
import { storeMayBeUsed } from '../../common/guards/store-jwt.guard';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import { JwtService, type SignedAccessToken } from '../auth-common/services/jwt.service';
import { PasswordService } from '../auth-common/services/password.service';
import {
  RefreshTokenService,
  type IssuedRefresh,
} from '../auth-common/services/refresh-token.service';
import { TokenHashService } from '../auth-common/services/token-hash.service';
import { EmailQueue } from '../email/queue/email.queue';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_PASSWORD_RESET_MESSAGE =
  'If an account exists for that email, we sent password reset instructions.';

export interface StoreClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface StoreSession {
  accessToken: SignedAccessToken;
  refresh: IssuedRefresh;
}

/** GET /auth/store/me — what the reseller portal renders from. */
export interface StoreMe {
  /**
   * The support session a staff member is inside this account on, or
   * null — which is nearly always. Drives the warning bar on every
   * page; a courtesy, never a control (FE-2).
   */
  readonly impersonation: ImpersonationBannerContext | null;
  /** StoreUser.id — the person signed in. */
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly fullName: string;
  readonly emailVerifiedAt: Date | null;
  /** The FIRST role held — a label, never what the portal gates on. */
  readonly roleKey: string;
  readonly roleName: string;
  /** Every `store_roles.key` held. */
  readonly roleKeys: readonly string[];
  readonly roleNames: readonly string[];
  /**
   * What the portal hides things by — the UNION of every role held.
   * FE-2: rendering, never permission.
   */
  readonly permissions: readonly string[];
  readonly store: {
    readonly id: string;
    readonly name: string;
    readonly displayName: string | null;
    readonly status: ResellerStoreStatus | null;
    readonly walletManagedBy: ResellerWalletManager | null;
    /** Presigned for 15 minutes; nothing in the bucket is public. */
    readonly logoUrl: string | null;
    readonly contactEmail: string | null;
    readonly contactPhone: string | null;
  };
  /** The one seller this store resells for (RS decision 1). */
  readonly seller: { readonly id: string; readonly companyName: string };
}

const STORE_GATE_SELECT = {
  id: true,
  kind: true,
  status: true,
  deletedAt: true,
  sellerId: true,
  name: true,
  seller: { select: { status: true, deletedAt: true } },
} as const;

/**
 * RS-2 — the reseller store portal's sign-in, session and credential
 * flows. The seller auth service's shape for the third identity.
 *
 * ── WHO MAY SIGN IN ──────────────────────────────────────────────────
 * Decided by `storeMayBeUsed` (the guard's own rule): the store must be
 * a RESELLER store that is ACTIVE or PAUSED, behind an APPROVED seller.
 * A store pending the seller's approval has no team yet; a rejected or
 * closed one never will again.
 *
 * ── CREDENTIAL MESSAGES ──────────────────────────────────────────────
 * Invitation, password reset, password changed and email verification
 * go by email only — their template codes match the seed's credential
 * pattern, so NOTIF-9 keeps them off every other channel.
 */
@Injectable()
export class StoreAuthService {
  private readonly logger = new Logger(StoreAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly password: PasswordService,
    private readonly jwt: JwtService,
    private readonly hashes: TokenHashService,
    private readonly refresh: RefreshTokenService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly spaces: SpacesService,
    private readonly impersonationBanner: ImpersonationBannerService,
  ) {}

  // ---------- LOGIN ----------

  async login(
    input: { email: string; password: string },
    ctx: StoreClientContext,
  ): Promise<StoreSession> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.client.storeUser.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        passwordHash: true,
        deletedAt: true,
        store: { select: STORE_GATE_SELECT },
      },
    });

    if (!user || user.deletedAt !== null) {
      // Pay the argon2 cost a real account would have cost. `storeUser.email`
      // is globally unique, so without this the refusal's TIMING answers
      // "is this address a store login anywhere in the system" — and the
      // soft-deleted case, where the address does exist, leaks the same way.
      await this.password.verifyDummy(input.password);
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'store.login.failure',
        entityType: 'store_user',
        entityId: user?.id ?? null,
        metadata: {
          attemptedEmail: normalizedEmail,
          reason: user ? 'soft_deleted' : 'user_not_found',
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      throw this.invalidCredentials();
    }

    const ok = await this.password.verify(user.passwordHash, input.password);
    if (!ok) {
      await this.audit.log({
        actorType: ActorType.STORE,
        actorId: user.id,
        sellerId: user.store.sellerId,
        action: 'store.login.failure',
        entityType: 'store_user',
        entityId: user.id,
        metadata: { reason: 'wrong_password', ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
      });
      throw this.invalidCredentials();
    }

    // The status is disclosed only AFTER the password checked out — to
    // an unknown caller "this store is closed" would confirm the email.
    this.assertStoreUsable(user.store);

    return this.prisma.client.$transaction(async (tx) => {
      const refresh = await this.refresh.issue({
        subject: 'store',
        userId: user.id,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        tx,
      });
      const accessToken = this.jwt.signStoreAccess({
        subject: user.id,
        storeId: user.store.id,
        sellerId: user.store.sellerId,
      });
      await tx.storeUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.log(
        {
          actorType: ActorType.STORE,
          actorId: user.id,
          sellerId: user.store.sellerId,
          action: 'store.login.success',
          entityType: 'store_user',
          entityId: user.id,
          metadata: {
            storeId: user.store.id,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            jti: accessToken.jti,
            refreshTokenId: refresh.recordId,
          },
        },
        tx,
      );
      return { accessToken, refresh };
    });
  }

  // ---------- REFRESH / LOGOUT ----------

  async rotateRefresh(plaintext: string, ctx: StoreClientContext): Promise<StoreSession> {
    if (!plaintext) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH',
        message: 'Invalid or expired refresh token',
      });
    }
    const { userId, issued } = await this.refresh.rotate({
      subject: 'store',
      presentedToken: plaintext,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, store: { select: STORE_GATE_SELECT } },
    });
    if (!user || !this.usable(user.store)) {
      // The rotated row must not outlive the refusal.
      await this.refresh.revokeByPlaintext('store', issued.token);
      throw this.notActive();
    }
    const accessToken = this.jwt.signStoreAccess({
      subject: user.id,
      storeId: user.store.id,
      sellerId: user.store.sellerId,
    });
    return { accessToken, refresh: issued };
  }

  async logout(refreshPlaintext: string): Promise<void> {
    if (refreshPlaintext) await this.refresh.revokeByPlaintext('store', refreshPlaintext);
  }

  async logoutAll(storeUserId: string, sellerId: string): Promise<{ revokedCount: number }> {
    const revokedCount = await this.refresh.revokeAllForUser({
      subject: 'store',
      userId: storeUserId,
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: storeUserId,
      sellerId,
      action: 'store.logout_all.success',
      entityType: 'store_user',
      entityId: storeUserId,
      metadata: { revokedCount },
    });
    return { revokedCount };
  }

  // ---------- PASSWORD RESET ----------

  async requestPasswordReset(
    input: { email: string },
    ctx: StoreClientContext,
  ): Promise<{ message: string }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.prisma.client.storeUser.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        store: { select: { id: true, name: true, displayName: true, sellerId: true } },
      },
    });
    if (!user) {
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'store.password_reset.requested',
        entityType: 'store_user',
        entityId: null,
        metadata: {
          attemptedEmail: normalizedEmail,
          outcome: 'unknown_email',
          ipAddress: ctx.ipAddress,
        },
      });
      return { message: GENERIC_PASSWORD_RESET_MESSAGE };
    }

    const plaintext = this.hashes.generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await this.prisma.client.storePasswordResetToken.create({
      data: {
        storeUserId: user.id,
        tokenHash: this.hashes.sha256Hex(plaintext),
        expiresAt,
        ipAddress: ctx.ipAddress,
      },
    });
    await this.email.enqueue({
      templateCode: 'store.password_reset.email',
      recipient: { type: NotificationRecipientType.STORE_USER, id: user.id, email: user.email },
      variables: {
        full_name: user.fullName,
        store_name: user.store.displayName ?? user.store.name,
        reset_url: `${this.env.resellerAppUrl}/auth/reset-password?token=${plaintext}`,
        expires_minutes: 30,
      },
      triggerEvent: 'store.password_reset.requested',
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.store.sellerId,
      action: 'store.password_reset.requested',
      entityType: 'store_user',
      entityId: user.id,
      metadata: { ipAddress: ctx.ipAddress, expiresAt: expiresAt.toISOString() },
    });
    return { message: GENERIC_PASSWORD_RESET_MESSAGE };
  }

  async confirmPasswordReset(
    input: { token: string; newPassword: string },
    ctx: StoreClientContext,
  ): Promise<{ ok: true }> {
    const row = await this.prisma.client.storePasswordResetToken.findFirst({
      where: { tokenHash: this.hashes.sha256Hex(input.token) },
      select: {
        id: true,
        storeUserId: true,
        expiresAt: true,
        usedAt: true,
        storeUser: {
          select: {
            email: true,
            fullName: true,
            deletedAt: true,
            store: { select: { sellerId: true } },
          },
        },
      },
    });
    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      row.storeUser.deletedAt !== null
    ) {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Reset link is invalid or has expired',
      });
    }
    const newHash = await this.password.hash(input.newPassword);
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      // Claimed on the state read: two tabs submitting the same link
      // cannot both set a password.
      const claimed = await tx.storePasswordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count === 0) {
        throw new BadRequestException({
          code: 'INVALID_RESET_TOKEN',
          message: 'Reset link is invalid or has expired',
        });
      }
      await tx.storeUser.update({
        where: { id: row.storeUserId },
        data: { passwordHash: newHash },
      });
      await tx.storeRefreshToken.updateMany({
        where: { storeUserId: row.storeUserId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.log(
        {
          actorType: ActorType.STORE,
          actorId: row.storeUserId,
          sellerId: row.storeUser.store.sellerId,
          action: 'store.password_reset.completed',
          entityType: 'store_user',
          entityId: row.storeUserId,
          metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
        },
        tx,
      );
    });

    // Tell the account holder, always; best-effort after the commit.
    try {
      await this.email.enqueue({
        templateCode: 'store.password_changed.email',
        recipient: {
          type: NotificationRecipientType.STORE_USER,
          id: row.storeUserId,
          email: row.storeUser.email,
        },
        variables: {
          email: row.storeUser.email,
          full_name: row.storeUser.fullName,
          changed_at: now.toUTCString(),
          login_url: `${this.env.resellerAppUrl}/login`,
          support_email: this.env.supportEmail,
          ip_address: ctx.ipAddress ?? 'unknown',
        },
        triggerEvent: 'store.password_reset.completed',
      });
    } catch (e) {
      this.logger.error(
        { storeUserId: row.storeUserId, err: (e as Error).message },
        'Store password-changed notice could not be queued; the password WAS changed',
      );
    }
    return { ok: true };
  }

  // ---------- EMAIL VERIFICATION ----------

  async requestEmailVerification(
    storeUserId: string,
    ctx: StoreClientContext,
  ): Promise<{ ok: true }> {
    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: storeUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailVerifiedAt: true,
        store: { select: { sellerId: true } },
      },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Store session no longer valid',
      });
    }
    if (user.emailVerifiedAt !== null) {
      throw new ConflictException({
        code: 'ALREADY_VERIFIED',
        message: 'Email is already verified',
      });
    }
    const plaintext = this.hashes.generateEmailVerificationToken();
    await this.prisma.client.storeEmailVerificationToken.create({
      data: {
        storeUserId: user.id,
        tokenHash: this.hashes.sha256Hex(plaintext),
        email: user.email,
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    await this.email.enqueue({
      templateCode: 'store.email_verification.email',
      recipient: { type: NotificationRecipientType.STORE_USER, id: user.id, email: user.email },
      variables: {
        full_name: user.fullName,
        verify_url: `${this.env.resellerAppUrl}/auth/verify-email?token=${plaintext}`,
        expires_hours: 24,
      },
      triggerEvent: 'store.email_verification.requested',
    });
    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: user.id,
      sellerId: user.store.sellerId,
      action: 'store.email_verification.requested',
      entityType: 'store_user',
      entityId: user.id,
      metadata: { ipAddress: ctx.ipAddress },
    });
    return { ok: true };
  }

  async confirmEmailVerification(
    input: { token: string },
    ctx: StoreClientContext,
  ): Promise<{ ok: true }> {
    const row = await this.prisma.client.storeEmailVerificationToken.findFirst({
      where: { tokenHash: this.hashes.sha256Hex(input.token) },
      select: {
        id: true,
        storeUserId: true,
        email: true,
        expiresAt: true,
        usedAt: true,
        storeUser: {
          select: { email: true, deletedAt: true, store: { select: { sellerId: true } } },
        },
      },
    });
    if (
      !row ||
      row.usedAt !== null ||
      row.expiresAt.getTime() <= Date.now() ||
      row.storeUser.deletedAt !== null ||
      row.storeUser.email !== row.email
    ) {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Verification link is invalid or has expired',
      });
    }
    await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.storeEmailVerificationToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) return;
      await tx.storeUser.update({
        where: { id: row.storeUserId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.STORE,
          actorId: row.storeUserId,
          sellerId: row.storeUser.store.sellerId,
          action: 'store.email_verification.completed',
          entityType: 'store_user',
          entityId: row.storeUserId,
          metadata: { ipAddress: ctx.ipAddress },
        },
        tx,
      );
    });
    return { ok: true };
  }

  // ---------- INVITATIONS ----------

  /**
   * What an invitation is for, so the accept page can say it before
   * asking for a password. A miss is ONE generic 404 whatever the reason
   * — expired, used, revoked or never issued — so a guessed token learns
   * nothing (the TRK-8 posture).
   */
  async previewInvitation(token: string): Promise<{
    email: string;
    fullName: string;
    storeName: string;
    roleName: string;
    expiresAt: string;
  }> {
    const inv = await this.liveInvitation(token);
    return {
      email: inv.email,
      fullName: inv.fullName,
      storeName: inv.store.displayName ?? inv.store.name,
      // Every role it offers, not just the first — somebody deciding
      // whether to accept should see what they are being given.
      roleName: inv.offered.map((r) => r.name).join(', '),
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  /**
   * Accept an invitation: create the store user, spend the invitation,
   * and sign them in — one transaction for the first two. The invitation
   * is CLAIMED with a guarded `updateMany` on `usedAt IS NULL`, so two
   * tabs submitting the same link cannot both make an account.
   */
  async acceptInvitation(
    input: { token: string; password: string; fullName: string },
    ctx: StoreClientContext,
  ): Promise<StoreSession> {
    const inv = await this.liveInvitation(input.token);
    this.assertStoreUsable(inv.store);

    const emailLower = inv.email.trim().toLowerCase();
    const passwordHash = await this.password.hash(input.password);
    const now = new Date();

    let created: { id: string };
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const claimed = await tx.storeUserInvitation.updateMany({
          where: { id: inv.id, usedAt: null, deletedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'INVITATION_ALREADY_USED',
            message: 'This invitation has already been used',
          });
        }
        const user = await tx.storeUser.create({
          data: {
            storeId: inv.store.id,
            email: emailLower,
            emailDisplay: inv.email,
            passwordHash,
            fullName: input.fullName.trim(),
            // Reaching this code needed a token mailed to this address.
            emailVerifiedAt: now,
            // The join rows in the same write as the user: a user row
            // without them cannot sign in at all.
            ...rolesOnCreate(inv.offered.map((r) => r.id)),
          },
          select: { id: true },
        });
        await tx.storeUserInvitation.update({
          where: { id: inv.id },
          data: { acceptedById: user.id },
        });
        return user;
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'That email already has a store login.',
        });
      }
      throw err;
    }

    await this.audit.log({
      actorType: ActorType.STORE,
      actorId: created.id,
      sellerId: inv.store.sellerId,
      action: 'store.team_invitation.accepted',
      entityType: 'store_user',
      entityId: created.id,
      severity: 'MEDIUM',
      metadata: {
        storeId: inv.store.id,
        invitationId: inv.id,
        // EVERY role they were granted, not the first — this is the row
        // somebody reads later to see what access this person was given.
        roles: inv.offered.map((r) => r.name),
        ipAddress: ctx.ipAddress,
      },
    });

    return this.prisma.client.$transaction(async (tx) => {
      const refresh = await this.refresh.issue({
        subject: 'store',
        userId: created.id,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        tx,
      });
      const accessToken = this.jwt.signStoreAccess({
        subject: created.id,
        storeId: inv.store.id,
        sellerId: inv.store.sellerId,
      });
      return { accessToken, refresh };
    });
  }

  // ---------- ME ----------

  /**
   * The cookie path of the hybrid /me (FE-4): re-checks the store gate
   * the guard would have applied, because /me is reached without it.
   */
  async assertMayUse(storeUserId: string): Promise<void> {
    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: storeUserId, deletedAt: null },
      select: { store: { select: STORE_GATE_SELECT } },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Store session no longer valid',
      });
    }
    this.assertStoreUsable(user.store);
  }

  async getMe(storeUserId: string): Promise<StoreMe> {
    const user = await this.prisma.client.storeUser.findFirst({
      where: { id: storeUserId, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        fullName: true,
        emailVerifiedAt: true,
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: {
            role: {
              select: {
                key: true,
                name: true,
                isOwner: true,
                deletedAt: true,
                permissions: { select: { permission: true } },
              },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            displayName: true,
            status: true,
            walletManagedBy: true,
            logoKey: true,
            contactEmail: true,
            contactPhone: true,
            seller: { select: { id: true, companyName: true } },
          },
        },
      },
    });
    // Every role gone is nobody to be — the guard's own answer, given
    // here too so the portal and the API cannot disagree about whether
    // somebody is signed in.
    const resolved = user === null ? null : resolveRoles(user.roles, ALL_STORE_PERMISSION_KEYS);
    if (!user || resolved === null || resolved.roles.length === 0) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Store session no longer valid',
      });
    }
    return {
      /**
       * Set only while a staff member is inside this account on a support
       * session — null on every ordinary request, which is nearly all of
       * them. It is what puts the warning bar on EVERY page rather than
       * only on the one the staff member arrived at.
       *
       * A COURTESY, not a control (FE-2): the guard refuses what a
       * session may not do whether or not a bar is drawn.
       */
      impersonation: await this.impersonationBanner.current(),
      id: user.id,
      email: user.email,
      emailDisplay: user.emailDisplay,
      fullName: user.fullName,
      emailVerifiedAt: user.emailVerifiedAt,
      roleKey: resolved.primary?.key ?? '',
      roleName: resolved.primary?.name ?? '',
      roleKeys: resolved.roles.map((r) => r.key),
      roleNames: resolved.roles.map((r) => r.name),
      permissions: resolved.permissions,
      store: {
        id: user.store.id,
        name: user.store.name,
        displayName: user.store.displayName,
        status: user.store.status,
        walletManagedBy: user.store.walletManagedBy,
        logoUrl: await this.presignLogo(user.store.logoKey),
        contactEmail: user.store.contactEmail,
        contactPhone: user.store.contactPhone,
      },
      seller: { id: user.store.seller.id, companyName: user.store.seller.companyName },
    };
  }

  // ---------- internal ----------

  /** A missing logo costs the picture, never the page. */
  private async presignLogo(key: string | null): Promise<string | null> {
    if (key === null) return null;
    try {
      return await this.spaces.presignGetUrl(key);
    } catch {
      return null;
    }
  }

  private async liveInvitation(token: string) {
    const inv = await this.prisma.client.storeUserInvitation.findUnique({
      where: { token: this.hashes.sha256Hex(token) },
      select: {
        id: true,
        email: true,
        fullName: true,
        expiresAt: true,
        usedAt: true,
        deletedAt: true,
        // `roles` is the whole of what the invitation offers.
        roles: {
          orderBy: [{ grantedAt: 'asc' as const }, { roleId: 'asc' as const }],
          select: { role: { select: { id: true, name: true, deletedAt: true } } },
        },
        store: { select: { ...STORE_GATE_SELECT, displayName: true } },
      },
    });
    if (
      !inv ||
      inv.usedAt !== null ||
      inv.deletedAt !== null ||
      inv.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException({
        code: 'INVALID_INVITATION',
        message: 'This invitation is not valid. Ask for a new one.',
      });
    }
    // The roles it actually offers, live ones only. ALL of them gone is
    // the same miss as a revoked token — accepting would make an account
    // the guard refuses, so it answers the same generic 404 rather than
    // telling a guessed token which roles a store has deleted.
    const offered = inv.roles.map((r) => r.role).filter((r) => r.deletedAt === null);
    if (offered.length === 0) {
      throw new NotFoundException({
        code: 'INVALID_INVITATION',
        message: 'This invitation is not valid. Ask for a new one.',
      });
    }
    return { ...inv, offered };
  }

  private usable(store: {
    kind: Parameters<typeof storeMayBeUsed>[0]['kind'];
    status: ResellerStoreStatus | null;
    deletedAt: Date | null;
    seller: {
      status: Parameters<typeof storeMayBeUsed>[0]['sellerStatus'];
      deletedAt: Date | null;
    };
  }): boolean {
    return storeMayBeUsed({
      kind: store.kind,
      status: store.status,
      deletedAt: store.deletedAt,
      sellerStatus: store.seller.status,
      sellerDeletedAt: store.seller.deletedAt,
    });
  }

  private assertStoreUsable(store: Parameters<StoreAuthService['usable']>[0]): void {
    if (!this.usable(store)) throw this.notActive();
  }

  private notActive(): ForbiddenException {
    return new ForbiddenException({
      code: 'STORE_NOT_ACTIVE',
      message: 'This store is not open. Contact the seller you resell for.',
    });
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid credentials',
    });
  }
}
