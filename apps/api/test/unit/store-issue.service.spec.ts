import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreIssueService } from '../../src/modules/ticket/services/store-issue.service';
import type { TicketService } from '../../src/modules/ticket/services/ticket.service';
import type { ResellerStoreActionPolicyService } from '../../src/modules/reseller-store/services/reseller-store-action-policy.service';

const ASK = {
  storeId: 'store-1',
  storeUserId: 'su-1',
  orderId: 'order-1',
  subject: 'Parcel came back crushed',
  description: 'Two of the three arrived broken.',
};

function make(mode: ResellerStoreActionMode) {
  const tickets = { openStoreIssue: jest.fn().mockResolvedValue({ id: 't1' }) };
  const policies = {
    forStore: jest.fn().mockResolvedValue({ storeId: 'store-1', chaseSkydrop: mode }),
  };
  return {
    tickets,
    policies,
    svc: new StoreIssueService(
      tickets as unknown as TicketService,
      policies as unknown as ResellerStoreActionPolicyService,
    ),
  };
}

describe('a store raising something with Skydrop (2026-09-16)', () => {
  it('DIRECT raises it as a STORE_ISSUE, not a dispute with the seller', async () => {
    const { svc, tickets } = make(ResellerStoreActionMode.DIRECT);
    await svc.raise(ASK);
    expect(tickets.openStoreIssue).toHaveBeenCalledWith({
      storeId: 'store-1',
      storeUserId: 'su-1',
      orderId: 'order-1',
      subject: ASK.subject,
      description: ASK.description,
    });
  });

  it('OFF refuses by name and writes nothing', async () => {
    const { svc, tickets } = make(ResellerStoreActionMode.OFF);
    await expect(svc.raise(ASK)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(tickets.openStoreIssue).not.toHaveBeenCalled();
  });

  it('ASK_SELLER is a REFUSAL here, never read as DIRECT', async () => {
    // You do not ask a seller's permission to tell Skydrop we damaged a
    // parcel — an approval step would let them suppress a complaint about
    // us. So the mode is refused by name rather than waved through.
    const { svc, tickets } = make(ResellerStoreActionMode.ASK_SELLER);
    await expect(svc.raise(ASK)).rejects.toMatchObject({
      response: { code: 'STORE_ACTION_NOT_ALLOWED' },
    });
    expect(tickets.openStoreIssue).not.toHaveBeenCalled();
  });
});
