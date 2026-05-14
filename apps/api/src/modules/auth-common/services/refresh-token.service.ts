import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ActorType, type Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TokenHashService } from './token-hash.service';
import { AuditLogService } from './audit-log.service';

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days, per spec

export type SubjectKind = 'staff' | 'seller';

export interface IssueRefreshInput {
  subject: SubjectKind;
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  tx?: Prisma.TransactionClient;
}

export interface IssuedRefresh {
  token: string;
  tokenHash: string;
  expiresAt: Date;
  recordId: string;
}

export interface RotateInput {
  subject: SubjectKind;
  presentedToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RotateOutput {
  userId: string;
  issued: IssuedRefresh;
}

/**
 * Implements the rotation + reuse-detection refresh-token flow described in
 * the auth spec.
 *
 *   - Issue:  random 32 bytes (url-safe base64) → store SHA-256 hash, return
 *             plaintext to caller (set into __Host-* cookie).
 *   - Rotate: look up by tokenHash. If not found / expired → unauthorized.
 *             If `revokedAt` is set → REUSE DETECTED:
 *               1. find every non-revoked token for that user,
 *               2. revoke them all in one transaction,
 *               3. write a `security.refresh_replay_detected` audit row with
 *                  severity HIGH **before** returning the error, so the event
 *                  survives even if the response fails downstream,
 *               4. throw UnauthorizedException.
 *             Otherwise: revoke the presented row, insert a fresh one, return
 *             the new plaintext. Whole rotate path is wrapped in a tx.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
  ) {}

  async issue(input: IssueRefreshInput): Promise<IssuedRefresh> {
    const token = this.hashes.generateRefreshToken();
    const tokenHash = this.hashes.sha256Hex(token);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    const client = input.tx ?? this.prisma.client;

    const data = {
      tokenHash,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt,
    };

    const recordId =
      input.subject === 'staff'
        ? (
            await client.staffRefreshToken.create({
              data: { ...data, staffUserId: input.userId },
              select: { id: true },
            })
          ).id
        : (
            await client.sellerRefreshToken.create({
              data: { ...data, sellerId: input.userId },
              select: { id: true },
            })
          ).id;

    return { token, tokenHash, expiresAt, recordId };
  }

  async rotate(input: RotateInput): Promise<RotateOutput> {
    const presentedHash = this.hashes.sha256Hex(input.presentedToken);

    return this.prisma.client.$transaction(async (tx) => {
      // 1. Look up the presented refresh-token row.
      const existing = await this.findByHash(tx, input.subject, presentedHash);

      if (!existing) {
        throw this.unauthorized();
      }

      // 2. Expired? Treat as a normal failure (no reuse signal).
      if (existing.expiresAt.getTime() <= Date.now()) {
        throw this.unauthorized();
      }

      // 3. Already revoked? That's a REUSE event. Burn down the family.
      if (existing.revokedAt !== null) {
        await this.handleReuseDetected(tx, input.subject, existing.userId, {
          presentedRecordId: existing.id,
          userAgent: input.userAgent ?? null,
          ipAddress: input.ipAddress ?? null,
        });
        throw this.unauthorized();
      }

      // 4. Happy path — revoke this row, mint a new one.
      await this.revokeById(tx, input.subject, existing.id);

      const issued = await this.issue({
        subject: input.subject,
        userId: existing.userId,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        tx,
      });

      await this.audit.log(
        {
          actorType: input.subject === 'staff' ? ActorType.STAFF : ActorType.SELLER,
          staffUserId: input.subject === 'staff' ? existing.userId : null,
          sellerId: input.subject === 'seller' ? existing.userId : null,
          action: `${input.subject}.refresh.rotated`,
          entityType: 'refresh_token',
          entityId: existing.id,
          metadata: {
            newRecordId: issued.recordId,
            ipAddress: input.ipAddress ?? null,
            userAgent: input.userAgent ?? null,
          },
        },
        tx,
      );

      return { userId: existing.userId, issued };
    });
  }

  /** Revoke every active refresh token for a given user (e.g., logout-all). */
  async revokeAllForUser(input: { subject: SubjectKind; userId: string }): Promise<number> {
    const now = new Date();
    if (input.subject === 'staff') {
      const r = await this.prisma.client.staffRefreshToken.updateMany({
        where: { staffUserId: input.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return r.count;
    }
    const r = await this.prisma.client.sellerRefreshToken.updateMany({
      where: { sellerId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return r.count;
  }

  /** Revoke a specific refresh token by its plaintext (used by logout). */
  async revokeByPlaintext(subject: SubjectKind, plaintext: string): Promise<boolean> {
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const now = new Date();
    if (subject === 'staff') {
      const r = await this.prisma.client.staffRefreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: now },
      });
      return r.count > 0;
    }
    const r = await this.prisma.client.sellerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    return r.count > 0;
  }

  // --- internals ---

  private async findByHash(
    tx: Prisma.TransactionClient,
    subject: SubjectKind,
    tokenHash: string,
  ): Promise<
    | {
        id: string;
        userId: string;
        expiresAt: Date;
        revokedAt: Date | null;
      }
    | null
  > {
    if (subject === 'staff') {
      const row = await tx.staffRefreshToken.findFirst({
        where: { tokenHash },
        select: { id: true, staffUserId: true, expiresAt: true, revokedAt: true },
      });
      return row
        ? { id: row.id, userId: row.staffUserId, expiresAt: row.expiresAt, revokedAt: row.revokedAt }
        : null;
    }
    const row = await tx.sellerRefreshToken.findFirst({
      where: { tokenHash },
      select: { id: true, sellerId: true, expiresAt: true, revokedAt: true },
    });
    return row
      ? { id: row.id, userId: row.sellerId, expiresAt: row.expiresAt, revokedAt: row.revokedAt }
      : null;
  }

  private async revokeById(
    tx: Prisma.TransactionClient,
    subject: SubjectKind,
    id: string,
  ): Promise<void> {
    const now = new Date();
    if (subject === 'staff') {
      await tx.staffRefreshToken.update({ where: { id }, data: { revokedAt: now } });
    } else {
      await tx.sellerRefreshToken.update({ where: { id }, data: { revokedAt: now } });
    }
  }

  private async handleReuseDetected(
    tx: Prisma.TransactionClient,
    subject: SubjectKind,
    userId: string,
    context: { presentedRecordId: string; userAgent: string | null; ipAddress: string | null },
  ): Promise<void> {
    // Revoke EVERY active token for this user — burn the family.
    const now = new Date();
    let revokedCount: number;
    if (subject === 'staff') {
      const r = await tx.staffRefreshToken.updateMany({
        where: { staffUserId: userId, revokedAt: null },
        data: { revokedAt: now },
      });
      revokedCount = r.count;
    } else {
      const r = await tx.sellerRefreshToken.updateMany({
        where: { sellerId: userId, revokedAt: null },
        data: { revokedAt: now },
      });
      revokedCount = r.count;
    }

    // Write audit row BEFORE the surrounding throw so the event survives
    // even if the HTTP response fails downstream.
    await this.audit.log(
      {
        actorType: subject === 'staff' ? ActorType.STAFF : ActorType.SELLER,
        staffUserId: subject === 'staff' ? userId : null,
        sellerId: subject === 'seller' ? userId : null,
        action: 'security.refresh_replay_detected',
        entityType: 'refresh_token',
        entityId: context.presentedRecordId,
        metadata: {
          subject,
          revokedCount,
          userAgent: context.userAgent,
          ipAddress: context.ipAddress,
        },
        severity: 'HIGH',
      },
      tx,
    );
  }

  private unauthorized(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_REFRESH',
      message: 'Invalid or expired refresh token',
    });
  }
}
