/**
 * @skydrop/ui — shared design tokens for every Skydrop frontend.
 *
 * Phase 1A scope (FE-6): TOKENS ONLY. Components stay in apps/admin
 * until apps/seller forces the extraction (per the locked decision).
 * The token system is shared NOW so admin+seller+track render the
 * same colors, type scale, and semantic status palette by
 * construction.
 *
 * Imports:
 *   import '@skydrop/ui/tokens.css';        // CSS variables (once, at the app root)
 *   import { orderStatusKind, kindTokens } from '@skydrop/ui/status';
 *   import { SPACING, TYPE_SCALE } from '@skydrop/ui/tokens';
 */
export * from './status/index.js';
export * from './tokens/index.js';
