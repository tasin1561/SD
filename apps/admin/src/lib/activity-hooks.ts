'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The parcel activity trail and the live holds board.
 *
 * Its own file rather than a nineteenth section of `ops-hooks.ts`: these
 * two reads are one feature, and the holds board is polled while the
 * trail is not, which is a difference worth seeing in one place.
 *
 * Every time field is an ISO instant named `*Iso`. The screen formats it
 * as a CLOCK TIME — never "in 23 minutes", because the floor re-reads a
 * screen minutes later without refetching and a relative time would have
 * gone silently stale.
 */

export type TrailActorKind =
  | 'STAFF'
  | 'STAFF_REMOVED'
  | 'SYSTEM'
  | 'SELLER'
  | 'STORE'
  | 'STAFF_AS_CLIENT'
  | 'API'
  | 'COURIER'
  | 'UNRECORDED'
  | 'UNKNOWN';

export interface TrailActor {
  readonly kind: TrailActorKind;
  readonly name: string | null;
}

export type ParcelActivityKind =
  | 'LABEL_GENERATED'
  | 'LABEL_PRINTED'
  | 'PICK_BATCH_CREATED'
  | 'PICK_BATCH_PRINTED'
  | 'PICK_CLAIMED'
  | 'PICKED'
  | 'PACK_BOX_OPENED'
  | 'PACK_BOX_CLOSED'
  | 'PACK_BOX_CANCELLED'
  | 'PACKED'
  | 'COURIER_CHOSEN'
  | 'MANIFEST_CLOSED'
  | 'MANIFEST_HANDOFF_CONFIRMED'
  | 'HANDOVER_SCANNED'
  | 'COURIER_PICKED_UP'
  | 'RTO_RECEIVED'
  | 'RTO_INSPECTED';

export interface ParcelActivityEvent {
  readonly key: string;
  readonly kind: ParcelActivityKind;
  readonly atIso: string;
  readonly atApproximate: boolean;
  readonly actor: TrailActor;
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly detail: Readonly<Record<string, string | number>> | null;
}

export interface ParcelActivityParcel {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly superseded: boolean;
  readonly lastTouch: ParcelActivityEvent | null;
}

export interface ParcelActivityTrail {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly parcels: readonly ParcelActivityParcel[];
  readonly events: readonly ParcelActivityEvent[];
}

export interface ParcelLastTouch {
  readonly shipmentId: string;
  readonly kind: ParcelActivityKind;
  readonly atIso: string;
  readonly actor: TrailActor;
}

export type FloorHoldKind = 'PICK' | 'PACK_CLAIM' | 'PACK_BOX' | 'PICK_BATCH';

export interface FloorHold {
  readonly key: string;
  readonly kind: FloorHoldKind;
  readonly holder: TrailActor;
  readonly shipmentNumber: string | null;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly batchNumber: string | null;
  readonly warehouseName: string | null;
  readonly sinceIso: string | null;
  readonly untilIso: string | null;
  readonly expired: boolean;
  readonly stuck: boolean;
  readonly detail: Readonly<Record<string, string | number>> | null;
}

export interface LabelReprint {
  readonly shipmentId: string;
  readonly shipmentNumber: string;
  readonly awbNumber: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly warehouseName: string | null;
  readonly sheets: number;
  readonly lastPrintedBy: TrailActor;
  readonly lastPrintedAtIso: string | null;
  readonly labelVersions: number;
}

export interface FloorHoldsView {
  readonly nowIso: string;
  readonly stuckAfterMinutes: number;
  readonly holds: readonly FloorHold[];
  readonly reprints: readonly LabelReprint[];
}

/** Who did what to this order's parcels. `orders.view` on the API. */
export function useParcelActivity(orderId: string): UseQueryResult<ParcelActivityTrail> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-orders', 'parcel-activity', orderId],
    queryFn: () =>
      client.request<ParcelActivityTrail>(`/api/admin/orders/${orderId}/parcel-activity`),
    enabled: Boolean(orderId),
  });
}

/**
 * Who last touched each of these parcels — one line for a bench row.
 *
 * ONE request for the whole visible list, not one per row: a bench
 * showing forty parcels would otherwise spend forty round trips on forty
 * sentences. The ids are sorted into the query key so the same list in a
 * different order is the same cache entry.
 */
export function useParcelLastTouch(
  shipmentIds: readonly string[],
): UseQueryResult<ReadonlyMap<string, ParcelLastTouch>> {
  const client = useApiClient();
  const ids = [...shipmentIds].sort();
  return useQuery({
    queryKey: ['admin-warehouse', 'parcel-last-touch', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const res = await client.request<{ items: readonly ParcelLastTouch[] }>(
        `/api/admin/warehouse/parcel-last-touch?shipmentIds=${encodeURIComponent(ids.join(','))}`,
      );
      return new Map(res.items.map((i) => [i.shipmentId, i]));
    },
  });
}

/**
 * Who holds what right now. `warehouse.view` on the API.
 *
 * Polled, because the whole value of the board is being current — and
 * `expired` is decided by the SERVER against the instant it read, so a
 * refetch is also how a lapsed hold stops reading as held.
 */
export function useFloorHolds(options?: {
  readonly enabled?: boolean;
}): UseQueryResult<FloorHoldsView> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin-warehouse', 'holds'],
    queryFn: () => client.request<FloorHoldsView>('/api/admin/warehouse/holds'),
    refetchInterval: 30_000,
    enabled: options?.enabled ?? true,
  });
}
