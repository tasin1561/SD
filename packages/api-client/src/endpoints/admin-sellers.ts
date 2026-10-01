/**
 * Admin seller-management surface (M2). Captured from the M12 pre-
 * flight. Defined here in CP1 so the api-client surface is stable
 * when the CP2 feature screens consume it.
 *
 * The CP2 "Seller management" feature area uses:
 *   GET  /admin/sellers              (list + filters)
 *   GET  /admin/sellers/:id          (detail w/ addresses + notes + onboarding + audit)
 *   PATCH /admin/sellers/:id/status  (suspend / reapprove — RBAC-gated by SUPER_ADMIN
 *                                     / SELLER_APPROVAL_ADMIN; the careful one)
 *   GET/POST/PATCH/DELETE /admin/sellers/:id/notes[/:noteId]
 *   GET  /admin/sellers/:id/onboarding
 *   POST /admin/sellers/:id/onboarding/:stepCode/override
 *   GET/POST/POST :id/resend/DELETE /admin/seller-invitations
 */

export type SellerStatusValue = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface ListSellersQuery {
  readonly status?: SellerStatusValue;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SellerListItem {
  /** Operations short code. Staff surface only — no seller endpoint returns it. */
  readonly initials?: string | null;
  readonly id: string;
  readonly email: string;
  readonly companyName: string;
  readonly contactPersonName: string;
  readonly status: SellerStatusValue;
  readonly approvedAt: string | null;
  readonly createdAt: string;
}

export interface SellerListResponse {
  readonly items: readonly SellerListItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface UpdateSellerStatusRequest {
  /** `newStatus`, NOT `targetStatus`. This type said targetStatus and
   *  `reason`; UpdateSellerStatusDto declares `newStatus` (required) and
   *  `reasonNote`. With forbidNonWhitelisted every suspend and every
   *  reapprove 400'd in production — verified live, not inferred. The
   *  RESPONSE type below always said `newStatus`, which is what made the
   *  file read as though it agreed with the server. */
  readonly newStatus: SellerStatusValue;
  readonly reasonNote?: string;
}

export interface UpdateSellerStatusResponse {
  readonly sellerId: string;
  readonly newStatus: SellerStatusValue;
}

/**
 * One row of `GET /admin/seller-invitations` — EXACTLY what that
 * endpoint sends, and nothing it does not.
 *
 * It used to declare `invitedAt`, which the API has never sent (it
 * sends `createdAt`), and `inviteUrl`, which only the CREATE and RESEND
 * responses carry. Neither was caught by anything: a declared-but-absent
 * field is `undefined` at runtime, so the lead drawer rendered
 * `new Date(undefined).toLocaleString()` — the literal string
 * "Invalid Date" — beside a perfectly correct expiry, on every
 * invitation anybody looked at. Found by filming it (O1, 2026-10-01).
 *
 * `status` carries 'deleted' too: the DTO's own list is
 * ['pending','used','expired','deleted'], and a soft-deleted invitation
 * really can come back from a filtered read.
 */
export interface SellerInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly status: 'pending' | 'used' | 'expired' | 'deleted';
  /** When the invitation was issued. The API's own field name. */
  readonly createdAt: string;
  readonly usedAt: string | null;
  readonly expiresAt: string;
}

/**
 * What CREATE and RESEND answer with: the row, plus the one-shot link.
 *
 * Separate from the list item on purpose — the URL exists only in the
 * response to the act that minted it, because only a hash of the token
 * is stored and nothing can reconstruct it afterwards. Putting it on
 * the list type said the opposite, and said it in the one place a
 * reader would look to find out.
 */
export interface SellerInvitationIssued extends SellerInvitationListItem {
  readonly inviteUrl: string;
}
