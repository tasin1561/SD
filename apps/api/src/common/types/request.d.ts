import type { SellerUserRole, StaffRole } from '@skydrop/db';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      staff?: AuthenticatedStaff;
      seller?: AuthenticatedSeller;
      apiKey?: AuthenticatedApiKey;
    }
  }
}

export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: StaffRole;
  emailVerifiedAt: Date | null;
  jti: string;
}

export interface AuthenticatedSeller {
  /**
   * Seller.id — the company. Existing controllers were written when one
   * seller account had one user, so this id is kept as the COMPANY id
   * for back-compat. Per-user attribution uses `userId` + `role` below.
   */
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  jti: string;
  /** SellerUser.id — the person who authenticated. */
  userId: string;
  /** SellerUser.role — used by requireSellerRoles. */
  role: SellerUserRole;
  /** SellerUser.fullName — for audit + UI display. */
  fullName: string;
}

export interface AuthenticatedApiKey {
  id: string;
  sellerId: string;
  keyPrefix: string;
}

export {};
