/**
 * Server-only auth surface. Safe to import from Next.js Server
 * Components / route handlers. NOT safe in the browser bundle (no
 * React APIs; depends only on global fetch).
 */
export { resolveStaffSsrIdentity, resolveSellerSsrIdentity } from './identity';
export type { SsrIdentityRequest, SsrIdentityResult } from './identity';
