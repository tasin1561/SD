import { CourierSupportRegistryService } from '../../src/modules/courier-escalation/services/courier-support-registry.service';
import type { CourierSupportAdapter } from '../../src/modules/courier-shared/services/courier-support-adapter';

function adapter(courierCode: string, getThread: boolean): CourierSupportAdapter {
  return {
    courierCode,
    capabilities: () => ({
      getThread,
      listUpdatedSince: getThread,
      getTaxonomy: getThread,
      postComment: false,
      raiseTicket: false,
    }),
  } as unknown as CourierSupportAdapter;
}

/**
 * The hazard this closes is latent rather than live, which is exactly
 * why it is worth a test: today NO courier support desk is readable, so
 * one shared adapter behaves identically to two. The day Delhivery's MCP
 * realm is provisioned, their read capabilities flip to true — and a
 * shared adapter would have the reconciler start reading Delhivery for
 * SHIPROCKET tickets. It would not throw; it would return nothing, and
 * the item would sit in SENT_UNCONFIRMED, the one state that needs a
 * read-back to leave.
 */
describe('CourierSupportRegistryService', () => {
  it('hands back the adapter for the courier that was asked about', () => {
    const svc = new CourierSupportRegistryService([
      adapter('delhivery', true),
      adapter('shiprocket', false),
    ]);

    expect(svc.for('delhivery')?.capabilities().getThread).toBe(true);
    // One desk becoming readable must not make the other look readable.
    expect(svc.for('shiprocket')?.capabilities().getThread).toBe(false);
  });

  it('returns NULL for an unknown courier rather than defaulting to the first', () => {
    const svc = new CourierSupportRegistryService([adapter('delhivery', true)]);
    // Defaulting is how a message intended for one company is filed
    // with another; the caller routes a null to a human.
    expect(svc.for('bluedart')).toBeNull();
  });

  it('lists every desk, so the console can say which is readable', () => {
    const svc = new CourierSupportRegistryService([
      adapter('delhivery', true),
      adapter('shiprocket', false),
    ]);
    expect(svc.known()).toEqual(['delhivery', 'shiprocket']);
  });

  it('an empty registry is answerable, not a crash', () => {
    const svc = new CourierSupportRegistryService([]);
    expect(svc.for('delhivery')).toBeNull();
    expect(svc.known()).toEqual([]);
  });
});
