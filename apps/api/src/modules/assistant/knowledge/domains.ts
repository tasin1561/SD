import type { AssistantAudience } from '@skydrop/db';

/**
 * Error-code domains: the module folder that throws a code, a plain
 * label for it, and WHO may be told about codes from it.
 *
 * Hand-written, not generated: labels are wording, and the visibility
 * list is an ACCESS decision that must be reviewed, never inferred.
 * A domain that is not listed in NON_STAFF_DOMAINS is staff-only by
 * default, so a new module can only ever leak by being added on purpose.
 */
const LABELS: ReadonlyArray<readonly [prefix: string, label: string]> = [
  ['warehouse-pack', 'Warehouse · packing'],
  ['warehouse-pick', 'Warehouse · picking'],
  ['warehouse-printing', 'Warehouse · label and picking-sheet printing'],
  ['warehouse-manifest', 'Warehouse · manifests and handover'],
  ['warehouse-rto', 'Warehouse · returns (RTO)'],
  ['warehouse-bin-ops', 'Warehouse · bins'],
  ['warehouse-activity', 'Warehouse · activity'],
  ['pick-allocation', 'Warehouse · picking'],
  ['call-center', 'Call centre'],
  ['call-queue', 'Call centre'],
  ['confirmation-policy', 'Call centre · confirmation'],
  ['order-csv-import', 'Orders · CSV import'],
  ['order-reattempt', 'Orders · re-attempt'],
  ['order', 'Orders'],
  ['delivery-action', 'Failed deliveries'],
  ['customer-return', 'Returns'],
  ['courier-manual-placement', 'Couriers · manual placement'],
  ['courier-dispatch', 'Couriers · dispatch'],
  ['courier-awb', 'Couriers · AWB'],
  ['courier-delhivery', 'Couriers · Delhivery'],
  ['courier-shiprocket', 'Couriers · Shiprocket'],
  ['courier-', 'Couriers'],
  ['tracking', 'Tracking'],
  ['consignment', 'Consignments (stock sent to the warehouse)'],
  ['inbound-freight', 'Inbound freight'],
  ['inventory-', 'Inventory and stock'],
  ['early-reservation', 'Stock reservations'],
  ['catalog-csv-import', 'Products · CSV import'],
  ['catalog-', 'Products'],
  ['seller-wallet', 'Wallet'],
  ['wallet-', 'Wallet'],
  ['seller-bank-change', 'Bank account'],
  ['seller-team', 'Team and roles'],
  ['seller-rbac', 'Team and roles'],
  ['seller-auth', 'Sign-in'],
  ['store-auth', 'Sign-in'],
  ['staff-auth', 'Sign-in'],
  ['auth-common', 'Sign-in'],
  ['seller-', 'Client account'],
  ['reseller-store-wallet', 'Member store · wallet'],
  ['reseller-store-terms', 'Member store · terms'],
  ['reseller-associates', 'Member store · associates'],
  ['reseller-catalogue', 'Member store · catalogue'],
  ['reseller-order', 'Member store · orders'],
  ['reseller-reports', 'Member store · reports'],
  ['reseller-store', 'Member store'],
  ['store-order-request', 'Member store · order requests'],
  ['ticket', 'Tickets'],
  ['address-check', 'Address check'],
  ['shipment-address', 'Address'],
  ['treasury', 'Finance · treasury'],
  ['pnl', 'Finance · profit and loss'],
  ['admin-remittance', 'Finance · remittances'],
  ['admin-', 'Admin'],
  ['staff-', 'Staff accounts'],
  ['impersonation', 'Support sessions'],
  ['notification', 'Notifications'],
  ['settings', 'Settings'],
  ['system-', 'System'],
  ['pricing', 'Pricing'],
  ['fx', 'FX rates'],
  ['invoice', 'Invoices'],
  ['email', 'Email'],
  ['chat', 'Chat'],
  ['assistant', 'Assistant'],
  ['common', 'General'],
];

/**
 * Domains whose error codes may be explained to a client, a member
 * store or an associate: the modules their own console's screens call.
 * Everything else (finance, couriers' internals, warehouse benches,
 * staff and system modules) is staff-only.
 */
const NON_STAFF_DOMAINS: ReadonlySet<string> = new Set([
  'common',
  'auth-common',
  'order',
  'order-attention',
  'order-charges',
  'order-csv-import',
  'order-journey',
  'order-reattempt',
  'delivery-action',
  'catalog-csv-import',
  'catalog-image',
  'catalog-product',
  'catalog-variant',
  'consignment',
  'consignment-core',
  'early-reservation',
  'inbound-freight',
  'pricing',
  'address-check',
  'shipment-address',
  'seller-address',
  'seller-api-key',
  'seller-auth',
  'seller-bank-change',
  'seller-invitation',
  'seller-notification-preference',
  'seller-onboarding',
  'seller-profile',
  'seller-rbac',
  'seller-restriction',
  'seller-store',
  'seller-team',
  'seller-tracking',
  'seller-wallet-read',
  'seller-wallet-withdrawal',
  'seller-webhook',
  'wallet-topup',
  'reseller-associates',
  'reseller-catalogue',
  'reseller-order',
  'reseller-order-gate',
  'reseller-order-money-view',
  'reseller-reports',
  'reseller-store-terms',
  'reseller-store-wallet',
  'store-auth',
  'store-order-request',
  'ticket',
  'tracking-public',
]);

export function domainLabel(domain: string): string {
  for (const [prefix, label] of LABELS) {
    if (domain === prefix || (prefix.endsWith('-') && domain.startsWith(prefix))) return label;
    if (!prefix.endsWith('-') && domain.startsWith(`${prefix}-`)) return label;
  }
  const words = domain.replace(/[-_.]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Can this audience be told about a code thrown from these (comma-joined) domains? */
export function domainVisibleTo(domains: string, audience: AssistantAudience): boolean {
  if (audience === 'STAFF') return true;
  return domains.split(',').some((d) => NON_STAFF_DOMAINS.has(d));
}

/** The first domain of the list this audience may be told about. */
export function firstVisibleDomain(domains: string, audience: AssistantAudience): string | null {
  const list = domains.split(',');
  if (audience === 'STAFF') return list[0] ?? null;
  return list.find((d) => NON_STAFF_DOMAINS.has(d)) ?? null;
}
