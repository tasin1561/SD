import { describe, expect, it } from 'vitest';
import { roleChangeConsequence, roleChangeSummary, roleLine, roleNamesOf } from '@/lib/role-words';

/**
 * The wording of a person's ROLES, pinned directly because it is pure.
 *
 * The two cases worth having a test for are the ones that look like
 * working software: a person holding several roles reading as holding
 * one, and a person holding a role with no legacy enum spelling reading
 * as holding none.
 */
describe('roleNamesOf', () => {
  it('returns EVERY role held', () => {
    expect(roleNamesOf({ roleNames: ['Ops', 'Finance'], roleName: 'Ops' })).toEqual([
      'Ops',
      'Finance',
    ]);
  });

  it('prefers the whole set over the first-role label', () => {
    // `roleName` is a label the server keeps truthful, and preferring it
    // is how three roles read as one.
    expect(roleNamesOf({ roleNames: ['Ops', 'Finance'], roleName: 'Ops' })).toHaveLength(2);
  });

  it('falls back to the first-role label for a payload written before roleNames existed', () => {
    expect(roleNamesOf({ roleName: 'Ops' })).toEqual(['Ops']);
  });

  it('is EMPTY when every role has been deleted from under its holder', () => {
    // A real state, not an error: `roleName` is '' on the wire for
    // somebody with no live role, and an empty string is not a role.
    expect(roleNamesOf({ roleNames: [], roleName: '' })).toEqual([]);
  });
});

describe('roleLine', () => {
  it('joins the set for a place with no room for chips', () => {
    expect(roleLine({ roleNames: ['Ops', 'Returns desk'] })).toBe('Ops · Returns desk');
  });

  it('says so rather than printing nothing when no role is held', () => {
    // An empty string here reads as a rendering fault; it used to print
    // an address followed by a bare interpunct.
    expect(roleLine({ roleNames: [] })).toBe('No role');
  });
});

describe('roleChangeSummary', () => {
  it('names what is gained and what is taken away', () => {
    expect(roleChangeSummary(['Ops', 'Finance'], ['Ops', 'Inventory'])).toEqual({
      added: ['Inventory'],
      removed: ['Finance'],
    });
  });

  it('is empty both ways when the set is unchanged, whatever the order', () => {
    expect(roleChangeSummary(['Ops', 'Finance'], ['Finance', 'Ops'])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe('roleChangeConsequence', () => {
  it('states the DIFFERENCE, not just the destination', () => {
    const s = roleChangeConsequence('Jo', ['Ops'], ['Ops', 'Finance']);
    expect(s).toContain('gains Finance');
    expect(s).toContain('Ops, Finance');
  });

  it('names a role being taken away', () => {
    expect(roleChangeConsequence('Jo', ['Ops', 'Finance'], ['Ops'])).toContain('loses Finance');
  });

  it('says something true while the field sits empty, and does not claim a refusal', () => {
    // The server owns NO_ROLES and its verdict is what gets shown; this
    // sentence only has to be honest in the meantime.
    const s = roleChangeConsequence('Jo', ['Ops'], []);
    expect(s).toContain('at least one');
    expect(s).not.toContain('NO_ROLES');
  });
});
