import { ForbiddenException, Injectable } from '@nestjs/common';
import { ResellerStoreActionMode } from '@skydrop/db';
import { ResellerStoreActionPolicyService } from '../../reseller-store/services/reseller-store-action-policy.service';
import { TicketService, type StoreTicketView } from './ticket.service';

/**
 * 2026-09-16 — the policy gate in front of a store raising something
 * with Skydrop.
 *
 * ── WHY THERE IS NO "ASK THE SELLER" HERE ────────────────────────────
 * `chaseSkydrop` is DIRECT or OFF in practice. You do not ask a seller's
 * permission to tell Skydrop we damaged a parcel — an approval step
 * there would let a seller suppress a complaint about us, which is the
 * opposite of what the queue is for. ASK_SELLER is therefore treated as
 * "not yours to do", with a message that says who does it instead,
 * rather than being silently read as DIRECT.
 */
@Injectable()
export class StoreIssueService {
  constructor(
    private readonly tickets: TicketService,
    private readonly policies: ResellerStoreActionPolicyService,
  ) {}

  async raise(input: {
    storeId: string;
    storeUserId: string;
    orderId: string;
    subject: string;
    description: string | null;
  }): Promise<StoreTicketView> {
    const policy = await this.policies.forStore(input.storeId);
    if (policy.chaseSkydrop !== ResellerStoreActionMode.DIRECT) {
      throw new ForbiddenException({
        code: 'STORE_ACTION_NOT_ALLOWED',
        message:
          policy.chaseSkydrop === ResellerStoreActionMode.OFF
            ? 'The seller has not enabled raising issues with Skydrop for this store. Raise it with them instead.'
            : 'The seller handles issues with Skydrop for this store. Raise it with them instead.',
      });
    }
    return this.tickets.openStoreIssue({
      storeId: input.storeId,
      storeUserId: input.storeUserId,
      orderId: input.orderId,
      subject: input.subject,
      description: input.description,
    });
  }
}
