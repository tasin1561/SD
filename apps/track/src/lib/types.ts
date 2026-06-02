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

export interface PublicTrackingResponse {
  readonly awbNumber: string;
  readonly courierDisplayName: string;
  readonly currentStatus: PublicShipmentDisplayStatus;
  readonly currentStatusAt: string;
  readonly destinationCity: string;
  readonly estimatedDeliveryAt: string | null;
  readonly timeline: ReadonlyArray<PublicTrackingTimelineEvent>;
}
