/**
 * @skydrop/auth — client/server auth session.
 *
 * For Server Components / route handlers: `import { resolveStaffSsrIdentity } from '@skydrop/auth/server'`.
 * For Client Components: `import { AuthProvider, useStaffIdentity } from '@skydrop/auth/client'`.
 *
 * The top-level index re-exports BOTH surfaces for consumers that
 * want one entry; production apps should prefer the explicit
 * server/client subpath imports so the bundler can tree-shake the
 * appropriate half.
 */
export * from './client/index.js';
export * from './server/index.js';
