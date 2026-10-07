import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PERMISSION_KEYS, RESERVED_PERMISSION_KEYS } from '../../src/common/auth/permissions';

/**
 * WHICH staff endpoints are gated, and by what.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Before permissions, 92 of the 156 admin handlers carried
 * `@UseGuards(StaffJwtGuard)` and nothing else. That guard
 * AUTHENTICATES; it never asked what the person was allowed to do. So
 * any staff member who could log in could call any of them — a call
 * agent could set the exchange rate that converts every seller's money
 * between INR and BDT.
 *
 * Nothing caught it because there was nothing to catch: an endpoint
 * without a check looks exactly like an endpoint that deliberately
 * needs none. This spec removes that ambiguity. Every staff handler
 * must SAY what it requires — either a permission, or `@StaffSelfService`
 * for the handful that are about the caller themselves.
 *
 * The guard fails closed at runtime, so a missing declaration is a 403
 * rather than a hole. This test turns that 403 into a failing build,
 * which is where you want to find it.
 *
 * ── WHY IT PARSES SOURCE ─────────────────────────────────────────────
 * Reading the decorators off booted classes would need the whole DI
 * graph. The question here is about what the source DECLARES, and
 * source is the honest thing to read for that.
 */

const SRC = join(__dirname, '../../src');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

interface Handler {
  readonly file: string;
  readonly name: string;
  readonly method: string;
  readonly route: string;
  readonly permissions: readonly string[] | 'self-service' | null;
}

const HTTP = String.raw`@(Get|Post|Patch|Put|Delete)\(`;

function parse(file: string): { readonly isStaff: boolean; readonly handlers: readonly Handler[] } {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('StaffJwtGuard')) return { isStaff: false, handlers: [] };

  const short = file.slice(file.lastIndexOf('/') + 1);
  const selfService = /\n@StaffSelfService\(\)/.test(src);
  const classPerms = /\n@RequirePermissions\(([^)]*)\)/.exec(src)?.[1];

  const handlers: Handler[] = [];
  const blocks = src.split(new RegExp(String.raw`\n  (?=${HTTP})`)).slice(1);
  for (const block of blocks) {
    const head = new RegExp(String.raw`^@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?`).exec(block);
    const name = /\n {2}(?:async )?(\w+)\(/.exec(block)?.[1];
    if (head === null || name === undefined) continue;

    const own = /\n {2}@RequirePermissions\(([^)]*)\)/.exec(block)?.[1];
    const raw = own ?? classPerms;
    handlers.push({
      file: short,
      name,
      method: head[1] ?? '',
      route: head[2] ?? '',
      permissions: selfService
        ? 'self-service'
        : raw === undefined
          ? null
          : [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? ''),
    });
  }
  return { isStaff: true, handlers };
}

const STAFF_HANDLERS: readonly Handler[] = controllerFiles(SRC)
  .map(parse)
  .filter((r) => r.isStaff)
  .flatMap((r) => r.handlers);

describe('staff permission surface', () => {
  it('finds the staff endpoints (guards against a parser that silently matches nothing)', () => {
    // A regex that stops matching would make every assertion below pass
    // vacuously, which is the failure mode a structural test has to rule
    // out first.
    expect(STAFF_HANDLERS.length).toBeGreaterThan(150);
  });

  it('every staff endpoint declares what it requires', () => {
    const undeclared = STAFF_HANDLERS.filter((h) => h.permissions === null).map(
      (h) => `${h.file} ${h.method} /${h.route} → ${h.name}()`,
    );
    expect(
      undeclared,
      // Jest prints the array; the message is for whoever reads the run.
    ).toEqual([]);
  });

  it('every declared permission exists in the catalogue', () => {
    const known = new Set<string>(ALL_PERMISSION_KEYS);
    const unknown = STAFF_HANDLERS.filter(
      (h) => h.permissions !== null && h.permissions !== 'self-service',
    ).flatMap((h) =>
      (h.permissions as readonly string[])
        .filter((p) => !known.has(p))
        .map((p) => `${h.file} ${h.name}() → '${p}'`),
    );
    expect(unknown).toEqual([]);
  });

  it('self-service is the narrow exception it is meant to be', () => {
    // Only the endpoints about the caller themselves — signing in and
    // out, their own password, their own identity. If this number grows,
    // something that needs a permission was given a pass instead.
    const selfService = STAFF_HANDLERS.filter((h) => h.permissions === 'self-service');
    const files = [...new Set(selfService.map((h) => h.file))].sort();
    expect(files).toEqual(
      [
        // Signing in and out, their own password, their own identity.
        'staff-auth.controller.ts',
        // Their own inbox, and their own standing choices about it.
        // Every row is addressed to the caller by the id on their
        // token — never by one in the request — so a permission would
        // be asking a question the token has already answered. It
        // would also have needed granting: a new key reaches no
        // EXISTING role without a backfill, so the bell would have
        // rendered and then 403'd for most of the estate. Sending TO
        // an audience is a different act and is gated, in its own
        // controller, on `notifications.broadcast`.
        'admin-notification.controller.ts',
      ].sort(),
    );
  });

  it('the dangerous permissions are each held by at least one endpoint', () => {
    // A permission nothing checks is a checkbox that does nothing, which
    // is worse than an absent one: it reads as a control.
    const used = new Set(
      STAFF_HANDLERS.filter(
        (h) => h.permissions !== null && h.permissions !== 'self-service',
      ).flatMap((h) => h.permissions as readonly string[]),
    );
    // RESERVED keys (RS-2 registers phase 3's) are the one named
    // exception, and the next test pins that they stay unused.
    const reserved = new Set(RESERVED_PERMISSION_KEYS);
    const orphaned = ALL_PERMISSION_KEYS.filter((k) => !used.has(k) && !reserved.has(k));
    expect(orphaned).toEqual([]);
  });

  it('no staff WRITE is gated only on a `.view` permission', () => {
    // `store-permission-surface.spec.ts` has had an assertion of this
    // shape since RS-2; the staff and seller surfaces did not, and three
    // handlers had drifted onto a READ key — minting an invoice number,
    // posting a ticket note that EMAILS the seller, and acknowledging a
    // system issue. A key whose label and description say "see" must not
    // also mean "change": what an operator is told when they tick the box
    // is all they have to go on.
    //
    // The store's version demands a `.manage` key. That is right for a
    // catalogue of fifteen keys and wrong for this one, which names the
    // ACT — `orders.force`, `warehouse.rto.finalize`,
    // `money.settlements.record` — so requiring `.manage` would mean
    // listing forty verbs and re-listing every new one. The rule that
    // actually catches the defect is narrower and needs no upkeep: a
    // write may not rest on a `.view` key alone.
    //
    // Exceptions are named WITH THEIR REASON, so a second has to be
    // argued for rather than added.
    //
    //   admin-system-issue.controller.ts acknowledge → system.settings.view
    //     "Record that somebody is on it." The LIST is deliberately on
    //     `view`, and the controller says why: an issue can come from
    //     anywhere — a courier login, a cost sync, a stalled poll — and a
    //     board only some people can see is a board where the rest get
    //     missed. Whoever can see it must be able to say they are on it;
    //     `.manage` would leave a warehouse supervisor staring at a
    //     problem they cannot claim. It closes nothing and moves no money.
    const VIEW_GATED_WRITES = new Set(['admin-system-issue.controller.ts acknowledge']);

    const loose = STAFF_HANDLERS.filter(
      (h) =>
        h.method !== 'Get' &&
        h.permissions !== 'self-service' &&
        h.permissions !== null &&
        h.permissions.length > 0 &&
        !VIEW_GATED_WRITES.has(`${h.file} ${h.name}`) &&
        h.permissions.every((p) => p.endsWith('.view')),
    ).map((h) => `${h.file} ${h.method} ${h.name}() → ${(h.permissions as string[]).join('|')}`);
    expect(loose).toEqual([]);
  });

  it('a reserved permission is declared by no endpoint (drop the flag when one arrives)', () => {
    const reserved = new Set(RESERVED_PERMISSION_KEYS);
    const declaring = STAFF_HANDLERS.filter(
      (h) => h.permissions !== null && h.permissions !== 'self-service',
    ).flatMap((h) =>
      (h.permissions as readonly string[])
        .filter((p) => reserved.has(p))
        .map((p) => `${h.file} ${h.name}() → '${p}'`),
    );
    expect(declaring).toEqual([]);
    // The list itself, named rather than counted, so adding a reserved
    // permission is a deliberate act somebody reads this comment while
    // doing. `reseller.credit_after_confirmation.enable` left it with
    // RS-4's per-seller switch.
    //
    // `support.impersonate.write` cannot be an endpoint gate even in
    // principle: `@RequirePermissions(a, b)` means a OR b, so "always
    // `support.impersonate`, and ALSO this when write is asked for"
    // is inexpressible as metadata. It is spent when the session is
    // opened and then lives on the row as `mayWrite`, which the
    // impersonation guard reads per request. It does not open one
    // endpoint; it decides whether a hundred ordinary seller endpoints
    // answer for the length of one session.
    expect([...reserved].sort()).toEqual(['support.impersonate.write']);
  });
});
