/**
 * Order charges endpoints (Module 17).
 *
 *   GET  /admin/orders/:orderId/charges       (admin view, all rows)
 *   POST /admin/orders/:orderId/charges/compute
 *                                              (compute via M15 + persist; idempotent
 *                                               on existing charges → 409)
 *   GET  /seller/orders/:orderId/charges      (seller view; isVisibleToSeller=true)
 */
import type { ChargeType, OrderChargeStatus } from '@skydrop/db';
import type { PricingPreviewResponse } from './admin-pricing';

export interface OrderChargeView {
  readonly id: string;
  readonly orderId: string;
  readonly shipmentId: string | null;
  readonly type: ChargeType;
  readonly amountInr: string;
  readonly taxRate: string | null;
  readonly taxAmountInr: string | null;
  readonly totalAmountInr: string;
  readonly description: string | null;
  readonly displayOrder: number;
  readonly isVisibleToSeller: boolean;
  readonly status: OrderChargeStatus;
  readonly createdAt: string;
}

export interface ComputeOrderChargesResponse {
  readonly orderId: string;
  readonly persistedCount: number;
  readonly compute: PricingPreviewResponse;
}
