/**
 * Client-side auth surface. Use under "use client" in Next.js.
 *
 *   import { AuthProvider, useStaffIdentity, hasStaffRole } from '@skydrop/auth/client';
 */
export { AuthProvider, useAuthCtx } from './context';
export type { AuthContextValue, AuthProviderProps } from './context';
export {
  useApiClient,
  useStaffIdentity,
  useSellerIdentity,
  useSetIdentity,
  useHasAccessToken,
  hasStaffRole,
} from './hooks';
