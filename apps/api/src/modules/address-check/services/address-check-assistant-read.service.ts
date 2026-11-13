import { Injectable } from '@nestjs/common';
import { AddressCheckService } from './address-check.service';

/** An address check explained, with the address itself left out. */
export interface AssistantAddressCheck {
  /** False when the check could not be made at all (their outage, or stub mode). */
  readonly available: boolean;
  /** 0-100, or null when there is no figure. */
  readonly score: number | null;
  readonly status: string;
  /** What the agent should do: approve, confirm_with_customer or reject. */
  readonly recommendedAction: string;
  readonly poConfidence: string | null;
  readonly issues: ReadonlyArray<{ readonly code: string; readonly message: string }>;
  /** Which part of the address the checker could improve, and why. */
  readonly suggestions: ReadonlyArray<{ readonly field: string; readonly reason: string | null }>;
  /** What to ask the customer on the call, in order. */
  readonly questionsForCustomer: readonly string[];
  readonly rtoRisk: number | null;
}

/**
 * What the assistant may read about the stored address check of ONE order.
 *
 * It calls `AddressCheckService.storedViewForOrder`, the very read the call
 * bench's `GET /admin/orders/:id/address-check` makes, and returns a view
 * WITHOUT the completed address, the extracted fields or the field sources:
 * the customer's street address is the one thing the assistant is built to
 * never receive. The order id is resolved by the caller's tool through the
 * order module; staff may read any order's check, exactly as the route
 * allows.
 */
@Injectable()
export class AddressCheckAssistantReadService {
  constructor(private readonly checks: AddressCheckService) {}

  async forOrder(orderId: string): Promise<AssistantAddressCheck | null> {
    const v = await this.checks.storedViewForOrder(orderId);
    if (v === null) return null;
    return {
      available: v.available,
      score: v.score,
      status: v.status,
      recommendedAction: v.action,
      poConfidence: v.poConfidence,
      issues: v.issues.map((i) => ({ code: i.code, message: i.message })),
      suggestions: v.suggestions.map((s) => ({ field: s.field, reason: s.reason ?? null })),
      questionsForCustomer: v.questions.map((q) => q.text),
      rtoRisk: v.rtoRisk,
    };
  }
}
