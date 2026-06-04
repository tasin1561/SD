export interface SellerApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface CreatedSellerApiKey {
  readonly id: string;
  readonly name: string;
  readonly keyPrefix: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  /** Plaintext API key — shown ONLY ONCE. */
  readonly plaintext: string;
}

export interface CreateSellerApiKeyRequest {
  readonly name: string;
  readonly expiresInDays?: number;
}
