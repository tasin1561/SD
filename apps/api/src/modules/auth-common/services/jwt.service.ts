import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { EnvService } from '../../../config/env.service';

export type TokenAudience = 'skydrop-staff' | 'skydrop-seller' | 'skydrop-store';

/**
 * RS-2 — a reseller store user's access token. Its OWN audience, so a
 * store token is refused by `verifySellerAccess` and a seller token by
 * `verifyStoreAccess` at the signature check, before anything is looked
 * up. That is what makes "a store login cannot reach the seller's
 * account" a property of the token rather than of each guard.
 */
export interface StoreAccessClaims extends JwtPayload {
  /** StoreUser.id. */
  sub: string;
  aud: 'skydrop-store';
  storeId: string;
  sellerId: string;
  jti: string;
}

const ACCESS_TTL_SECONDS = 5 * 60; // 5 min, per spec

export interface StaffAccessClaims extends JwtPayload {
  sub: string;
  aud: 'skydrop-staff';
  role: string;
  jti: string;
}

export interface SellerAccessClaims extends JwtPayload {
  /** SellerUser.id — the person who signed in (Phase 1B RBAC). */
  sub: string;
  aud: 'skydrop-seller';
  status: string;
  /** Parent Seller.id (the company). */
  sellerId: string;
  /** SellerUser.role. */
  role: string;
  jti: string;
}

export interface SignedAccessToken {
  token: string;
  jti: string;
  expiresIn: number;
  expiresAt: Date;
}

@Injectable()
export class JwtService {
  constructor(private readonly env: EnvService) {}

  signStaffAccess(input: { subject: string; role: string }): SignedAccessToken {
    return this.sign({
      payload: { role: input.role },
      subject: input.subject,
      audience: 'skydrop-staff',
    });
  }

  signSellerAccess(input: {
    subject: string;
    status: string;
    sellerId: string;
    role: string;
  }): SignedAccessToken {
    return this.sign({
      payload: { status: input.status, sellerId: input.sellerId, role: input.role },
      subject: input.subject,
      audience: 'skydrop-seller',
    });
  }

  signStoreAccess(input: {
    subject: string;
    storeId: string;
    sellerId: string;
  }): SignedAccessToken {
    return this.sign({
      payload: { storeId: input.storeId, sellerId: input.sellerId },
      subject: input.subject,
      audience: 'skydrop-store',
    });
  }

  verifyStoreAccess(token: string): StoreAccessClaims {
    return this.verify<StoreAccessClaims>(token, 'skydrop-store');
  }

  verifyStaffAccess(token: string): StaffAccessClaims {
    return this.verify<StaffAccessClaims>(token, 'skydrop-staff');
  }

  verifySellerAccess(token: string): SellerAccessClaims {
    return this.verify<SellerAccessClaims>(token, 'skydrop-seller');
  }

  // --- internal ---

  private sign(input: {
    payload: Record<string, unknown>;
    subject: string;
    audience: TokenAudience;
  }): SignedAccessToken {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + ACCESS_TTL_SECONDS * 1000);
    const token = jwt.sign(input.payload, this.env.jwtSigningKey, {
      algorithm: 'HS256',
      subject: input.subject,
      audience: input.audience,
      issuer: 'skydrop',
      jwtid: jti,
      expiresIn: ACCESS_TTL_SECONDS,
    });
    return { token, jti, expiresIn: ACCESS_TTL_SECONDS, expiresAt };
  }

  private verify<T extends JwtPayload>(token: string, expectedAudience: TokenAudience): T {
    try {
      const decoded = jwt.verify(token, this.env.jwtSigningKey, {
        algorithms: ['HS256'],
        audience: expectedAudience,
        issuer: 'skydrop',
      });
      if (typeof decoded === 'string') {
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid access token' });
      }
      return decoded as T;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired access token',
      });
    }
  }
}
