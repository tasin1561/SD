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
function build(updateManyCount = 1, opts: { automation?: boolean | null | 'throws' } = {}) {
  const updateMany = jest.fn(async () => ({ count: updateManyCount }));
  const update = jest.fn(async () => ({}));
  // `?? true` would turn a DELIBERATE null — "the row is absent" — into
  // the default, which is how the absent-setting case silently tested
  // the on-switch instead.
  const automation = 'automation' in opts ? opts.automation : true;
  const findUnique = jest.fn(async () => {
    if (automation === 'throws') throw new Error('settings unreadable');
    return automation === null ? null : { valueBoolean: automation };
  });
  const svc = new TicketHandlingService({
    client: { ticket: { updateMany, update }, systemSetting: { findUnique } },
  } as never);
  return { svc, updateMany, update, findUnique };
}

describe('what a courier makes possible', () => {
  it('Delhivery is automated when the switch is on', async () => {
    const { svc } = build();
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.AUTO);
  });

  it('Shiprocket is NOT — there is no ticket automation for it', async () => {
    // Not a judgement about the courier: a property of what we built.
    // Labelling it AUTO would say software is carrying something that
    // nothing is carrying.
    const { svc } = build();
    await expect(svc.initialFor('shiprocket')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('a manually-placed parcel is manual by definition', async () => {
    const { svc } = build();
    await expect(svc.initialFor('manual')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('no courier at all means no courier conversation', async () => {
    // A scrap ticket from RTO inspection has nobody outside to tell —
    // neither waiting on software nor on a person.
    const { svc, findUnique } = build();
    await expect(svc.initialFor(null)).resolves.toBe(TicketHandling.NONE);
    await expect(svc.initialFor('')).resolves.toBe(TicketHandling.NONE);
    // And it does not go asking about a switch that cannot apply.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('is case-insensitive about the courier code', async () => {
    const { svc } = build();
    await expect(svc.initialFor('Delhivery')).resolves.toBe(TicketHandling.AUTO);
  });
});

describe('the operator switch (courier.ticket_automation_enabled)', () => {
  it('OFF means a person carries even a Delhivery ticket', async () => {
    // The whole point of the switch: the portal automation is capable
    // and we are choosing not to use it yet.
    const { svc } = build(1, { automation: false });
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('an absent setting means manual, not automated', async () => {
    // A key that never seeded must not silently arm the automation.
    const { svc } = build(1, { automation: null });
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('an unreadable setting means manual', async () => {
    // Fail to the cheaper mistake: manual costs somebody's afternoon,
    // where a wrong AUTO files real tickets with a real courier under a
    // switch somebody deliberately turned off.
    const { svc } = build(1, { automation: 'throws' });
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('does not consult the switch for a courier with no automation', async () => {
    // Shiprocket is manual whatever the switch says; asking would imply
    // the switch could make it automated.
    const { svc, findUnique } = build(1, { automation: true });
    await expect(svc.initialFor('shiprocket')).resolves.toBe(TicketHandling.MANUAL);
    expect(findUnique).not.toHaveBeenCalled();
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
