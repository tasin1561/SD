import { ResellerStoreActionMode } from '@skydrop/db';
import { StoreIssueService } from '../../src/modules/ticket/services/store-issue.service';
import type { TicketService } from '../../src/modules/ticket/services/ticket.service';
import type { StoreOrderRequestService } from '../../src/modules/store-order-request/services/store-order-request.service';
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
  const requests = { hold: jest.fn().mockResolvedValue({ id: 'req-1', status: 'PENDING' }) };
  return {
    tickets,
    policies,
    requests,
    svc: new StoreIssueService(
      tickets as unknown as TicketService,
      policies as unknown as ResellerStoreActionPolicyService,
      requests as unknown as StoreOrderRequestService,
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

  it('ASK_SELLER holds it for seller staff and reaches Skydrop with nothing (owner, 2026-09-17)', async () => {
    const { svc, tickets, requests } = make(ResellerStoreActionMode.ASK_SELLER);
    const out = await svc.raise(ASK);
    expect(out).toMatchObject({ applied: false, ticket: null, request: { id: 'req-1' } });
    expect(tickets.openStoreIssue).not.toHaveBeenCalled();
    expect(requests.hold).toHaveBeenCalledWith({
      storeId: 'store-1',
      storeUserId: 'su-1',
      orderId: 'order-1',
      kind: 'RAISE_ISSUE',
      note: ASK.description,
      issueSubject: ASK.subject,
    });
  });
});
