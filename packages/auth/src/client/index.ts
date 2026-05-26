/**
 * Client-side auth surface. Use under "use client" in Next.js.
 *
 *   import { AuthProvider, useStaffIdentity, hasStaffRole } from '@skydrop/auth/client';
 */
export { AuthProvider, useAuthCtx } from './context.js';
export type { AuthContextValue, AuthProviderProps } from './context.js';
export {
  useApiClient,
  useStaffIdentity,
  useSellerIdentity,
  useSetIdentity,
  useHasAccessToken,
  hasStaffRole,
} from './hooks.js';
