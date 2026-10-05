import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The reseller-store invite BODY has to agree with the DTO that
 * validates it.
 *
 * ── WHY THIS TEST EXISTS ────────────────────────────────────────────
 * `InviteStoreUserDto` went plural (`roleKey` → `roleKeys`) and three
 * call sites in this app kept sending the old field: creating a store,
 * approving a Skydrop-created one, and inviting a store member. Under
 * the API's global `whitelist + forbidNonWhitelisted` each request then
 * failed TWICE — `roleKey` unknown AND `roleKeys` missing — and since an
 * invitation has been REQUIRED to create or approve a store since
 * 2026-09-16 (RS-1: a store nobody can sign in to and nobody can ring is
 * a row that looks open and can do nothing), no reseller store could be
 * opened at all.
 *
 * ── AND WHY NEITHER EXISTING GATE CAUGHT IT ─────────────────────────
 * `InviteInput` is this app's OWN interface, so `tsc` was perfectly
 * happy with a wire shape the server rejects — a type is only a contract
 * where both ends read the same declaration, and here they do not.
 * `scripts/check-frontend-routes.py` compares PATHS, and the path had
 * not changed; only the body had. That is the same shape as the seller
 * image-upload feature that shipped calling a URL which 404'd with a
 * body the API rejected, and which nothing caught because nothing had
 * exercised it.
 *
 * So the check has to cross the boundary: read the DTO's own property
 * name out of the API source and assert this app sends THAT. The API
 * source is read rather than imported — different app, different
 * tsconfig — which is the idiom `page-access-alignment.test.ts` and the
 * wallet CREDIT_DIRECTIONS cross-check already use.
 */
const API_DTO = join(
  __dirname,
  '../../../api/src/modules/reseller-store/dto/reseller-store.dto.ts',
);
const HOOKS = join(__dirname, '..', 'lib', 'reseller-store-hooks.ts');
const STORES_INDEX = join(__dirname, '..', 'app', '(authed)', 'reseller-stores', 'page.tsx');
const STORE_DETAIL = join(
  __dirname,
  '..',
  'app',
  '(authed)',
  'reseller-stores',
  '[storeId]',
  'page.tsx',
);

function withoutComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** The declared properties of one `class X { … }` in the DTO file. */
function dtoProperties(src: string, className: string): readonly string[] {
  const at = src.indexOf(`class ${className} {`);
  expect(at, `${className} not found in the API DTO`).toBeGreaterThan(-1);
  // Up to the next top-level `}` that closes the class.
  const body = src.slice(at, src.indexOf('\n}', at));
  return Array.from(body.matchAll(/^\s{2}(\w+)!?\??:/gm), (m) => m[1] ?? '');
}

describe('the API DTO is the authority on the invite body', () => {
  const dto = withoutComments(readFileSync(API_DTO, 'utf8'));
  const props = dtoProperties(dto, 'InviteStoreUserDto');

  it('reads the DTO at all — a regex that stops matching would pass every assertion below vacuously', () => {
    expect(props.length).toBeGreaterThanOrEqual(3);
    expect(props).toContain('email');
    expect(props).toContain('fullName');
  });

  it('names the ROLE field plural, and this app declares the same one', () => {
    const roleField = props.find((p) => p.toLowerCase().startsWith('role'));
    expect(roleField).toBe('roleKeys');

    const hooks = withoutComments(readFileSync(HOOKS, 'utf8'));
    const invite = hooks.slice(hooks.indexOf('interface InviteInput'));
    expect(invite).toContain(`${roleField ?? 'roleKeys'}:`);
  });

  it('this app declares no singular roleKey on the invite input', () => {
    const hooks = withoutComments(readFileSync(HOOKS, 'utf8'));
    const invite = hooks.slice(
      hooks.indexOf('interface InviteInput'),
      hooks.indexOf('interface CreateResellerStoreInput'),
    );
    // `roleKeys:` must not satisfy this, hence the negative lookahead.
    expect(invite).not.toMatch(/\broleKey(?!s)\s*[?!]?:/);
  });
});

describe('no reseller-store request sends the singular field', () => {
  for (const [name, file] of [
    ['the stores index (create a store)', STORES_INDEX],
    ['the store detail (approve, invite a member)', STORE_DETAIL],
  ] as const) {
    it(`${name} sends roleKeys`, () => {
      const src = withoutComments(readFileSync(file, 'utf8'));
      // A singular `roleKey:` in an object literal is the bug. State
      // and props named `roleKey` would be caught by the same pattern,
      // which is wanted: there is no longer a single role to hold.
      expect(src).not.toMatch(/\broleKey(?!s)\s*:/);
      expect(src).toContain('roleKeys');
    });
  }
});

describe('the store team screen shows every role held', () => {
  const src = withoutComments(readFileSync(STORE_DETAIL, 'utf8'));

  it('reads the whole set rather than the first-role label', () => {
    // `roleName` is the FIRST role, a label the server keeps truthful.
    // A member who is Ops AND Finance read as Ops — on the screen a
    // seller uses to check who at a store can reach its money.
    expect(src).toContain('roleLine(');
    expect(src).not.toMatch(/\{[mi]\.roleName\}/);
  });

  it('offers several roles on the invitation form', () => {
    expect(src).toContain('MultiSelect');
  });

  it('names no error code — which refusal an empty set draws is the server’s', () => {
    for (const code of ['NO_ROLES', 'BAD_REQUEST', 'UNAUTHORIZED'] as const) {
      expect(src).not.toContain(`'${code}'`);
      expect(src).not.toContain(`"${code}"`);
    }
  });
});
