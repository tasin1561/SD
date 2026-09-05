/**
 * @skydrop/ui/components — shared React primitives.
 *
 * Token-driven (FE-6), extraction-ready: NO `@/...` imports, every
 * color sourced from CSS variables declared in `tokens.css`. Both
 * apps/admin and apps/seller consume from this subpath; the
 * component shape was forced by needing two consumers (M13 CP1).
 *
 * Consumers:
 *   import { Button, Card, Modal } from '@skydrop/ui/components';
 *
 * Token + status imports stay on their own subpaths:
 *   import { OrderStatusBadge } from '@skydrop/ui/components';
 *   import { kindTokens, orderStatusKind } from '@skydrop/ui/status';
 */
export * from './app-shell';
export * from './barcode';
export * from './button';
export * from './card';
export * from './data-table';
export * from './feedback';
export * from './money';
export * from './notification-bell';
export * from './open-external';
export * from './order-journey';
export * from './form';
export * from './modal';
export * from './menu-button';
export * from './message-relay-status';
export * from './page';
export * from './product-thumb';
export * from './status-badge';
export * from './theme-init';
export * from './theme-toggle';
export * from './toast';
