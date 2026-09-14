/**
 * Mirror of apps/api PublicTrackingResponse — kept here as a local
 * type because apps/track is intentionally dependency-light (no
 * @skydrop/api-client to avoid pulling in auth/store).
 */
export type PublicShipmentDisplayStatus =
  | 'processing'
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_attempted'
  | 'delivered'
  | 'return_initiated'
  | 'returning'
  | 'returned'
  | 'lost'
  | 'damaged'
  | 'cancelled';

export interface PublicTrackingTimelineEvent {
  readonly status: PublicShipmentDisplayStatus;
  readonly eventAt: string;
  readonly description: string | null;
  readonly locationCity: string | null;
}

/** RS-10 — present only when a reseller store sold the order. */
export interface PublicSoldBy {
  readonly name: string;
  /** Short-lived presigned URL; null when the store has no logo. */
  readonly logoUrl: string | null;
}

export interface PublicTrackingResponse {
  readonly soldBy?: PublicSoldBy;
  readonly awbNumber: string;
  readonly courierDisplayName: string;
  readonly currentStatus: PublicShipmentDisplayStatus;
  readonly currentStatusAt: string;
  readonly destinationCity: string;
  readonly estimatedDeliveryAt: string | null;
  readonly timeline: ReadonlyArray<PublicTrackingTimelineEvent>;
}
