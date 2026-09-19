import { TicketHandling } from '@skydrop/db';
import { TicketHandlingService } from '../../src/modules/ticket-handling/services/ticket-handling.service';

/**
 * WHO is carrying a ticket to the courier.
 *
 * The whole point is that a ticket nothing is carrying SAYS SO: one
 * that stays silent about it sits in a queue nobody is watching,
 * because everybody assumes software has it.
 *
 * ── NO COURIER TAKES TICKETS FROM US (CUR-20) ───────────────────────
 * `AUTOMATED_COURIERS` held `['delhivery']` while Delhivery's OWN
 * support adapter reported `raiseTicket: false` — their MCP is
 * read-only and their REST API has no ticketing endpoint. The list was
 * asserting a capability the adapter had already denied, and it was
 * DORMANT (the automation sits behind a seeded-off switch, and
 * `portalMode` is OFF in production), which is exactly why it could be
 * wrong for months: the day somebody flipped the switch, Delhivery
 * tickets would have been stamped AUTO and then moved by nobody.
 *
 * So every courier is MANUAL now, and these tests say so per courier
 * rather than in one sweep — the list is per courier, so the drift
 * would be too. `courier-support-parity.spec.ts` pins the list against
 * each adapter's `capabilities()`, which is what stops it drifting
 * back.
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
  it('Delhivery is MANUAL even with the switch on — their API takes no ticket', async () => {
    // Not a judgement about the courier: a property of what EXISTS.
    // Delhivery One's MCP is read-only and their REST API has no
    // ticketing endpoint, which their own support adapter reports as
    // `raiseTicket: false`. Stamping AUTO here would say software is
    // carrying something that nothing is carrying.
    const { svc } = build();
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.MANUAL);
  });

  it('Shiprocket is manual too — there is no ticket automation for it', async () => {
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
    // The lower-casing still matters: it is what decides membership of
    // the list, and the list is what a future automation would join.
    const { svc } = build();
    await expect(svc.initialFor('Delhivery')).resolves.toBe(TicketHandling.MANUAL);
    await expect(svc.initialFor('SHIPROCKET')).resolves.toBe(TicketHandling.MANUAL);
  });
});

/*
  The switch SURVIVES, and is currently consulted for nobody.

  It is the reversible half of the decision — "a person handles these
  for now" is something somebody decides on a Tuesday about the state of
  the portal automation, and it has to be undoable without a deploy on
  either side. What changed is the OTHER half: the courier list is
  empty, so no courier reaches the switch at all.

  Keeping the switch's own behaviour pinned is deliberate. The day a
  courier's adapter can genuinely raise a ticket it joins the list, and
  these are the tests that say what the switch then does — a switch
  whose behaviour nothing describes is one somebody flips and believes.
*/
describe('the operator switch (courier.ticket_automation_enabled)', () => {
  it.each(['delhivery', 'shiprocket', 'manual'])(
    'is never even consulted for %s — nothing is automated today',
    async (code) => {
      // Asking would imply the switch could make it AUTO, and the
      // question a caller would then be tempted to ask themselves.
      const { svc, findUnique } = build(1, { automation: true });
      await expect(svc.initialFor(code)).resolves.toBe(TicketHandling.MANUAL);
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['OFF', false as const],
    ['absent', null],
    ['unreadable', 'throws' as const],
  ])('%s cannot make anything automated either', async (_label, automation) => {
    // Fail to the cheaper mistake: manual costs somebody's afternoon,
    // where a wrong AUTO files real tickets with a real courier under a
    // switch somebody deliberately turned off.
    const { svc } = build(1, { automation });
    await expect(svc.initialFor('delhivery')).resolves.toBe(TicketHandling.MANUAL);
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
