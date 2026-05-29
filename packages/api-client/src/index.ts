/**
 * @skydrop/api-client — typed same-origin fetch client with
 * single-flight refresh-on-401. Identity-parameterized (staff +
 * seller share the mechanics).
 */
export { ApiClient, ApiError } from './client';
export type { ApiClientOptions, ApiRequestInit, IdentityKind } from './client';
export { AccessTokenStore } from './auth/token-store';
export type { AccessTokenSnapshot, AccessTokenListener } from './auth/token-store';
export { SingleFlightRefresh } from './refresh/single-flight';
export type { RefreshFn, RefreshOutcome } from './refresh/single-flight';

export type {
  AccessTokenResponse,
  LoginRequest,
  StaffMe,
  SellerMe,
} from './endpoints/auth';
export type {
  ListSellersQuery,
  SellerListItem,
  SellerListResponse,
  SellerStatusValue,
  UpdateSellerStatusRequest,
  UpdateSellerStatusResponse,
  SellerInvitationListItem,
} from './endpoints/admin-sellers';
export type {
  ListOrdersQuery,
  OrderListItem,
  OrderListResponse,
  OrderItemView,
  OrderView,
  AdminCancelOrderRequest,
  TransitionStatusResult,
  ForceMutationFields,
  ForceMutationRequest,
  ForceMutationResult,
  ReserveAttemptOutcome,
  ReleaseReservationsRequest,
  ReleaseReservationsResult,
} from './endpoints/admin-orders';
export type {
  ListSellerOrdersQuery,
  SellerOrderEventView,
} from './endpoints/seller-orders';
export type {
  ListSellerProductsQuery,
  SellerProductView,
  SellerProductListResponse,
  UpdateSellerProductRequest,
  SellerVariantView,
  UpdateSellerVariantRequest,
  PresignVariantImageRequest,
  PresignVariantImageResponse,
  RegisterVariantImageRequest,
  SellerVariantImageView,
} from './endpoints/seller-catalog';
