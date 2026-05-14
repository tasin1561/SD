import type { StaffRole } from '@skydrop/db';

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
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  jti: string;
}

export interface AuthenticatedApiKey {
  id: string;
  sellerId: string;
  keyPrefix: string;
}

export {};
