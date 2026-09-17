import { ForbiddenException, Injectable } from '@nestjs/common';
import { ResellerStoreActionMode, StoreOrderRequestKind } from '@skydrop/db';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import {
  StoreOrderRequestService,
  type StoreOrderRequestView,
} from '../../store-order-request/services/store-order-request.service';
import { TicketService, type StoreTicketView } from './ticket.service';

/**
 * What came of a store raising an issue: the ticket, or a request waiting
 * on seller staff. A union rather than a nullable ticket.
 */
export type StoreIssueOutcome =
  | { readonly applied: true; readonly ticket: StoreTicketView; readonly request: null }
  | { readonly applied: false; readonly ticket: null; readonly request: StoreOrderRequestView };

/**
 * 2026-09-16 — the policy gate in front of a store raising something
 * with Skydrop.
 *
 * ── ASK_SELLER IS A HELD REQUEST (2026-09-17, owner) ─────────────────
 * This used to refuse "ask the seller", on the reasoning that an approval
 * step lets a seller suppress a complaint about us. The owner decided
 * otherwise: a seller may choose to see a store's issue before it reaches
 * Skydrop. So ASK_SELLER holds the subject and description for seller
 * staff; approving opens exactly the ticket a DIRECT raise opens,
 * attributed to the store; rejecting sends nothing to Skydrop and the
 * store is told why. OFF still refuses by name.
 */
@Injectable()
export class StoreIssueService {
  constructor(
    private readonly tickets: TicketService,
    private readonly policies: ResellerStoreActionPolicyService,
    private readonly requests: StoreOrderRequestService,
  ) {}

  async raise(input: {
    storeId: string;
    storeUserId: string;
    orderId: string;
    subject: string;
    description: string | null;
  }): Promise<StoreIssueOutcome> {
    const policy = await this.policies.forStore(input.storeId);
    if (policy.chaseSkydrop === ResellerStoreActionMode.OFF) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          'The seller has not enabled raising issues with Skydrop for this store. Raise it with them instead.',
      });
    }
    if (policy.chaseSkydrop === ResellerStoreActionMode.ASK_SELLER) {
      const request = await this.requests.hold({
        storeId: input.storeId,
        storeUserId: input.storeUserId,
        orderId: input.orderId,
        kind: StoreOrderRequestKind.RAISE_ISSUE,
        note: input.description,
        issueSubject: input.subject,
      });
      return { applied: false, ticket: null, request };
    }
    const ticket = await this.tickets.openStoreIssue({
      storeId: input.storeId,
      storeUserId: input.storeUserId,
      orderId: input.orderId,
      subject: input.subject,
      description: input.description,
    });
    return { applied: true, ticket, request: null };
  }
}
