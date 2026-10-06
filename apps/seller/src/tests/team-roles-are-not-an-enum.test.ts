import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Team roles come from the SERVER and a person holds SEVERAL.
 *
 * Two separate failures are pinned here, both of which look like working
 * software:
 *
 *  1. The invitation form carried a hardcoded list of the six legacy
 *     `SellerUserRole` values and posted `role: 'OPS'`. Roles have been
 *     rows for a while, so a company could build exactly the role a new
 *     colleague needed under Team → Roles and then had no way to invite
 *     anybody onto it. Nothing failed — the invitation was created, with
 *     the wrong access.
 *
 *  2. Every screen that showed "the role" read `.role`, the legacy enum,
 *     which was NULL for anybody holding only roles the company
 *     invented. A null prints as nothing, so the one surface that most
 *     needs to be right about custom roles was blank for exactly the
 *     people who have them, silently. The field has since been dropped
 *     from the API shapes, which is why the sweep below is for a read of
 *     ANY single role rather than for that one spelling: the next way
 *     this goes wrong is a screen settling for `roleName`, the FIRST
 *     role, and calling it theirs.
 *
 * Pinned by reading the source rather than by rendering, because both
 * failures are an ABSENCE: a render test asserting "a role is shown"
 * passes while the wrong role is shown, and a test driving the form
 * passes against a mock that accepts either body shape.
 *
 * ── COMMENTS ARE STRIPPED FIRST, AND THAT IS LOAD-BEARING ───────────
 * RBAC-1 records a spec that asserted `@SellerRoles` appeared in a file
 * when the only occurrence left was inside a comment EXPLAINING the
 * decorator that had been deleted. It passed while testing nothing, for
 * weeks, next to a live access-control hole. The files scanned below
 * have docblocks that name `SellerUserRole`, `OWNER` and `VIEWER` for
 * exactly that reason — prose about a rule reads like the rule to a
 * regex.
 */
const TEAM = join(__dirname, '..', 'app', '(authed)', 'team', '_components');
const INVITE_MODAL = join(TEAM, 'invite-member-modal.tsx');
const TEAM_INDEX = join(TEAM, 'team-management-index.tsx');
const REVEAL_CARD = join(TEAM, 'invite-link-reveal-card.tsx');
const HOOKS = join(__dirname, '..', 'lib', 'api-hooks.ts');

function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function read(path: string): string {
  return withoutComments(readFileSync(path, 'utf8'));
}

/** The six legacy enum spellings, as a hardcoded option would carry them. */
const LEGACY_ENUM_VALUES = ['OWNER', 'ADMIN', 'OPS', 'INVENTORY', 'FINANCE', 'VIEWER'] as const;

describe('the invitation form offers the company’s OWN roles', () => {
  const src = read(INVITE_MODAL);

  it('reads the roles from the server, not from a list in this file', () => {
    expect(src).toContain('useRoles()');
  });

  it('carries no hardcoded legacy role value', () => {
    // Quoted, so `roleIds`/`roleNames` identifiers cannot satisfy it and
    // a re-introduced `{ value: 'OPS', … }` cannot hide.
    const found = LEGACY_ENUM_VALUES.filter(
      (v) => src.includes(`'${v}'`) || src.includes(`"${v}"`),
    );
    expect(found).toEqual([]);
  });

  it('accepts SEVERAL roles', () => {
    expect(src).toContain('MultiSelect');
    expect(src).toContain('roleIds');
  });

  it('sends roleIds and NOT a single role', () => {
    expect(src).toMatch(/roleIds,/);
    expect(src).not.toMatch(/\brole,\s*$/m);
    expect(src).not.toMatch(/\brole:\s/);
  });

  it('does not block submit on an empty selection — the server owns that refusal (FE-2)', () => {
    // A length check in the disabled expression is the client-side
    // mirror this rule exists to keep out. `disabled={busy}` is fine.
    expect(src).not.toMatch(/disabled=\{[^}]*roleIds\.length/);
  });
});

describe('the team screen shows every role a person holds', () => {
  const src = read(TEAM_INDEX);

  it('renders roleNames, not one role', () => {
    expect(src).toContain('roleNamesOf');
  });

  it('writes through the plural hook', () => {
    expect(src).toContain('useUpdateTeamMemberRoles');
    expect(src).not.toContain('useUpdateTeamMemberRole(');
  });

  it('does not grey out the owner role — the server decides who is the last one', () => {
    // A `disabled` computed from a role being the owner's, or from a
    // holder count, is a client-side copy of the last-owner rule. Only
    // the server can count the owners left: it counts them through the
    // join table, inside the write's own transaction, and somebody
    // holding Owner as one of several roles still counts as one.
    expect(src).not.toMatch(/isOwner[^\n]*disabled/);
    expect(src).not.toMatch(/disabled[^\n]*isOwner/);
  });
});

/**
 * ── THE SCREEN KNOWS NO ERROR CODES ─────────────────────────────────
 * Every refusal reaches the person through `serverVerdict`, which
 * renders `[CODE] message` from whatever came back. The moment a
 * component names a code it has started to have an opinion about the
 * server's vocabulary, and that opinion goes stale silently — the
 * empty-set refusal changed shape ONCE during this very change, from a
 * validation error to something else, which is the argument rather than
 * a hypothetical.
 *
 * The list is the codes `SellerTeamService` can actually throw. A new
 * one is only a problem if a component starts reacting to it by name.
 */
const SERVER_CODES = [
  'NO_ROLES',
  'LAST_OWNER',
  'ROLE_NOT_FOUND',
  'MEMBER_NOT_FOUND',
  'CANNOT_CHANGE_OWN_ROLE',
  'CANNOT_DEACTIVATE_SELF',
  'EMAIL_ALREADY_REGISTERED',
  'INVITATION_ALREADY_PENDING',
  'INVITATION_ALREADY_USED',
  'INVITATION_NOT_FOUND',
  'INVITATION_EXPIRED',
  'INVITATION_ROLES_GONE',
  'INVALID_INVITATION',
  'UNAUTHORIZED',
] as const;

describe('no team screen reacts to a server error code by name', () => {
  for (const file of [INVITE_MODAL, TEAM_INDEX, REVEAL_CARD, HOOKS]) {
    const name = file.replace(/.*\/(src\/)?/, '');
    it(`${name} names none of them`, () => {
      const src = read(file);
      const found = SERVER_CODES.filter(
        (c) => src.includes(`'${c}'`) || src.includes(`"${c}"`) || src.includes(`\`${c}\``),
      );
      expect(found).toEqual([]);
    });
  }
});

describe('the one-shot invitation reveal', () => {
  it('names every offered role rather than one of them', () => {
    const src = read(REVEAL_CARD);
    expect(src).toContain('roleNames');
  });
});

/**
 * ── NO SCREEN READS A SINGLE `role` ─────────────────────────────────
 * The field is gone from the API shapes, so TypeScript now catches a
 * read of it — but only while the object being read is typed. A `any`,
 * a fixture, a destructured response or a hand-written fetch is not,
 * and this is the file where that came back once already.
 *
 * Any receiver, not the three names that happened to be in use when the
 * enum was removed: `row.role` and `u.role` sailed past that version of
 * this check. The boundary `\b` plus the negative lookahead keep
 * `roleId`, `roleKey`, `roleName`, `roleIds` and `roleNames` out of it,
 * and a JSX `role="status"` has no dot in front.
 */
describe('no team screen reads "the role"', () => {
  for (const file of [INVITE_MODAL, TEAM_INDEX, REVEAL_CARD, HOOKS]) {
    const name = file.replace(/.*\/(src\/)?/, '');
    it(`${name} reads the set, never one role`, () => {
      expect(read(file)).not.toMatch(/\.role\b(?![A-Za-z])/);
    });
  }
});

describe('the role-assignment hook', () => {
  const src = read(HOOKS);

  it('PATCHes the plural route with a list', () => {
    expect(src).toContain('/roles`');
    expect(src).toContain('body: { roleIds }');
  });

  it('keeps no single-role writer beside it', () => {
    // Two writers of one fact is how they come to disagree; the
    // transitional `/role` route exists on the server for the deploy
    // window and must not be reachable from here afterwards.
    expect(src).not.toContain('/role`');
  });
});
