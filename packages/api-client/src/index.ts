/**
 * @skydrop/api-client — typed same-origin fetch client with
 * single-flight refresh-on-401. Identity-parameterized (staff +
 * seller share the mechanics).
 */
export { ApiClient, ApiError } from './client.js';
export type { ApiClientOptions, ApiRequestInit, IdentityKind } from './client.js';
export { AccessTokenStore } from './auth/token-store.js';
export type { AccessTokenSnapshot, AccessTokenListener } from './auth/token-store.js';
export { SingleFlightRefresh } from './refresh/single-flight.js';
export type { RefreshFn, RefreshOutcome } from './refresh/single-flight.js';

export type {
  AccessTokenResponse,
  LoginRequest,
  StaffMe,
  SellerMe,
} from './endpoints/auth.js';
export type {
  ListSellersQuery,
  SellerListItem,
  SellerListResponse,
  SellerStatusValue,
  UpdateSellerStatusRequest,
  UpdateSellerStatusResponse,
  SellerInvitationListItem,
} from './endpoints/admin-sellers.js';
export type {
  ListOrdersQuery,
  OrderListItem,
  OrderListResponse,
  OrderEventView,
  OrderItemView,
  OrderView,
  AdminCancelOrderRequest,
  TransitionStatusResult,
  ForceMutationFields,
  ForceMutationRequest,
  ForceMutationResult,
  ReleaseReservationsRequest,
  ReleaseReservationsResult,
} from './endpoints/admin-orders.js';
