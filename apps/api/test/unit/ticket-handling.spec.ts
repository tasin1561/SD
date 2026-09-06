import { TicketHandling } from '@skydrop/db';
import { TicketHandlingService } from '../../src/modules/ticket-handling/services/ticket-handling.service';

/**
 * WHO is carrying a ticket to the courier.
 *
 * The whole point is that a ticket nothing is carrying SAYS SO. Only
 * Delhivery has ticket automation; a Shiprocket or manually-placed
 * parcel has no portal to drive, so its issue moves only when a person
 * moves it — and a ticket that stays silent about that sits in a queue
 * nobody is watching, because everybody assumes software has it.
 */
function build(updateManyCount = 1) {
  const updateMany = jest.fn(async () => ({ count: updateManyCount }));
  const update = jest.fn(async () => ({}));
  const svc = new TicketHandlingService({
    client: { ticket: { updateMany, update } },
  } as never);
  return { svc, updateMany, update };
}

describe('what a courier makes possible', () => {
  it('Delhivery is automated', () => {
    const { svc } = build();
    expect(svc.initialFor('delhivery')).toBe(TicketHandling.AUTO);
  });

  it('Shiprocket is NOT — there is no ticket automation for it', () => {
    // Not a judgement about the courier: a property of what we built.
    // Labelling it AUTO would say software is carrying something that
    // nothing is carrying.
    const { svc } = build();
    expect(svc.initialFor('shiprocket')).toBe(TicketHandling.MANUAL);
  });

  it('a manually-placed parcel is manual by definition', () => {
    const { svc } = build();
    expect(svc.initialFor('manual')).toBe(TicketHandling.MANUAL);
  });

  it('no courier at all means no courier conversation', () => {
    // A scrap ticket from RTO inspection has nobody outside to tell —
    // neither waiting on software nor on a person.
    const { svc } = build();
    expect(svc.initialFor(null)).toBe(TicketHandling.NONE);
    expect(svc.initialFor('')).toBe(TicketHandling.NONE);
  });

  it('is case-insensitive about the courier code', () => {
    const { svc } = build();
    expect(svc.initialFor('Delhivery')).toBe(TicketHandling.AUTO);
  });
});

describe('falling back when the automation fails', () => {
  it('moves AUTO to MANUAL, guarded on it still being AUTO', async () => {
    const { svc, updateMany } = build(1);
    await expect(svc.fallBackToManual('t1')).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't1', handling: TicketHandling.AUTO },
      data: { handling: TicketHandling.MANUAL },
    });
  });

  it('reports false when nothing moved, so a retry raises no second alarm', async () => {
    // A ticket already manual is not made "more manual" by a second
    // failure. The count is what tells the caller this was the
    // transition worth telling somebody about.
    const { svc } = build(0);
    await expect(svc.fallBackToManual('t1')).resolves.toBe(false);
  });

  it('never falls FORWARD — there is no manual-to-auto path', () => {
    // A conversation a person has picked up must not be handed back to
    // software halfway through: they are the only one who knows what
    // they have already said. Asserted structurally because the absence
    // of a method is the guarantee.
    const { svc } = build();
    expect((svc as unknown as Record<string, unknown>)['fallForwardToAuto']).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(svc))).toEqual(
      expect.not.arrayContaining(['promoteToAuto', 'fallForwardToAuto']),
    );
  });
});
