/**
 * The scope vocabulary, mirrored from the API's
 * `seller-api-key-scopes.ts`. Labels for the boxes; the SERVER decides
 * what each one covers, and refuses a value it does not know.
 */
export const SELLER_API_KEY_SCOPES = [
  { key: 'orders:read', label: 'Read orders', description: 'Order list, detail and tracking.' },
  {
    key: 'orders:write',
    label: 'Place and cancel orders',
    description:
      'Create, edit before confirmation, cancel before packing, upload as CSV. Also opens the platform-wide customer check.',
  },
  {
    key: 'customers:read',
    label: 'Read customers',
    description: 'Who your orders went to, and their history with you.',
  },
  {
    key: 'catalog:read',
    label: 'Read the catalogue',
    description: 'Products, variants and images.',
  },
  {
    key: 'catalog:write',
    label: 'Edit the catalogue',
    description: 'Add and change products, variants and images.',
  },
  {
    key: 'inventory:read',
    label: 'Read stock',
    description: 'What is in the warehouse, and inbound consignments.',
  },
  { key: 'tickets:read', label: 'Read issues', description: 'Damage, scrap and parcel issues.' },
  { key: 'tickets:write', label: 'Raise an issue', description: 'Report a problem with a parcel.' },
] as const;

export type SellerApiKeyScope = (typeof SELLER_API_KEY_SCOPES)[number]['key'];

export interface SellerApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly scopes: readonly string[];
}

export interface CreatedSellerApiKey {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly scopes: readonly string[];
  /** Plaintext API key — shown ONLY ONCE. */
  readonly plaintext: string;
}

export interface CreateSellerApiKeyRequest {
  readonly name: string;
  readonly expiresInDays?: number;
  /** At least one. A key with none grants nothing and is refused. */
  readonly scopes: readonly SellerApiKeyScope[];
}
