import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_STORE_ROLES } from '../../src/common/auth/store-permissions';

/**
 * ASSOC-1 boundary 2 — WHAT AN ASSOCIATE CAN BE TOLD.
 *
 * The owner's constraint, verbatim: *"the associate shouldn't be able to
 * see that how much the reseller is getting paid and whats the cost?"*
 *
 * ── WHY A SWEEP AND NOT A LIST ───────────────────────────────────────
 * `impersonation-deny-list.spec.ts` records what happens when a boundary
 * is "enforced" by a spec that checks a hand-written set of routes
 * somebody had already thought about: the claim held for exactly the
 * routes it was not needed for, and eleven live routes were open the
 * whole time. So this reads the CONTROLLERS, derives which of them an
 * `associate` role reaches from `DEFAULT_STORE_ROLES` itself, follows
 * each one's declared response type through the interfaces it names, and
 * looks at every field name that can come out of it.
 *
 * A route added tomorrow is swept by construction. A permission added to
 * the associate role widens the sweep by construction. Neither needs
 * anybody to remember this file exists.
 *
 * ── NEITHER ANSWER IS THE DEFAULT ────────────────────────────────────
 * Every (route, field) pair the sweep flags is either on
 * `DELIBERATELY_VISIBLE` with the reason it is safe, or on `OPEN_LEAKS`
 * with the harm. Both are one line, neither is what happens if you say
 * nothing, and the decision is forced in the commit that adds the field
 * — by the person who knows what it is.
 *
 * It is keyed on (ROUTE, FIELD) rather than on the route alone, which is
 * stricter than the deny list's prefixes on purpose: clearing a whole
 * route would mean a field added to `StoreOrderView` next month inherits
 * an exemption written for a different field.
 *
 * ── COMMENTS ARE STRIPPED BEFORE ANY SCAN ────────────────────────────
 * A docblock explaining a rule reads exactly like the rule to a regex,
 * and a spec in this repo has already passed while asserting on one.
 *
 * ── OVER-MATCHING IS THE SAFE DIRECTION ──────────────────────────────
 * The vocabulary below matches more than it strictly must, and the
 * escape hatch for a genuine false positive is one line on
 * `DELIBERATELY_VISIBLE`. Tightening it is the move that looks like a
 * correctness fix and silently reopens the thing it was protecting —
 * which is the lesson `forbidden-while-impersonating` learned the
 * expensive way.
 */

const SRC = join(__dirname, '../../src');
/** apps/api — what `provenBy` paths are relative to. */
const API_ROOT = join(__dirname, '../..');

/**
 * A field name that could tell an associate what the STORE pays or what
 * the STORE earns.
 *
 * `transfer` rather than `transferPrice`: `transferTotalInr` and
 * `transferInr` are the same fact on a different grain, and a
 * vocabulary that names one spelling of a figure protects that spelling.
 * `netinr` and `profit` are the earnings side; `payout` is the money
 * leaving. The rest are RS-3's own terms — the store's cost, the retail
 * range the seller set, the hidden share, the set-asides and the wallet.
 */
const STORE_COST_OR_EARNINGS =
  /transfer|unitcost|cost|margin|earn|feeshare|credit|suggestedretail|minretail|maxretail|hidden|setaside|wallet|netinr|payout|profit/i;

// ─────────────────────────────────────────────────────────────────────
// The two decision lists.
// ─────────────────────────────────────────────────────────────────────

interface Decision {
  /** Routes as `METHOD /path`, exactly as the sweep prints them. */
  readonly routes: readonly string[];
  readonly fields: readonly string[];
  readonly why: string;
}

/**
 * Flagged, and SAFE — with the reason, per field.
 *
 * "Safe" here means one thing only: it tells the reader no figure about
 * what the store pays or what the store earns.
 */
const DELIBERATELY_VISIBLE: readonly Decision[] = [
  {
    routes: ['GET /auth/store/me'],
    fields: ['walletManagedBy'],
    why: 'WHO manages the store wallet — Skydrop or the seller — and never a balance, a movement or a figure of any kind. The portal reads it to decide which nav to draw, and an identity endpoint every signed-in store user calls is the one place it can come from. A BALANCE here would not be safe, which is why this is named per field rather than clearing the route.',
  },
  {
    routes: [
      'POST /store/orders',
      'GET /store/orders/:id',
      'POST /store/orders/:id/cancel',
      'PATCH /store/orders/:orderId/recipient',
    ],
    fields: ['cost'],
    why: 'The key the three leaked fields were MOVED INTO when they were closed on 2026-10-08, not a field that leaks. `StoreOrderLineView.cost` and `totals.cost` are DISCRIMINATED UNIONS on the caller’s scope: at OWN the value is `{visible: false}` and carries nothing, and a reader must narrow on `visible` before touching the other arm — so a cost field added to that arm next month is unreachable at OWN scope by the TYPE SYSTEM rather than by somebody remembering a filter. It is named here rather than removed from the vocabulary, and rather than renamed to something the matcher misses: `cost` is the honest name for what it holds, and a key renamed to dodge a safety check is the move that looks like a fix and is not. What makes this ENTRY honest in turn is that a type-level sweep cannot see which arm ships — `associate-scope.e2e-spec.ts` is what proves the keys are genuinely ABSENT on the wire at OWN scope while an ALL-scope caller gets `{visible: true, transferInr: …}`, against a real database. Keyed per field, so `costBreakdownInr` appearing beside it still fails.',
  },
];

/**
 * Flagged, and NOT safe — the sweep's own findings, each with the harm.
 *
 * ── EMPTY AS OF 2026-10-08, AND IT DID NOT START THAT WAY ────────────
 * The sweep found THREE on its first run, and every one of them
 * predated associates: each response was designed for a store whose team
 * all held `catalogue.view` and `terms.view`, so carrying the store's
 * own cost on it was correct. The `associate` role is the first store
 * login for which it is not. They were the order view's per-line
 * transfer price and retail range, `GET /store/orders/:id/money`, and
 * RS-7's `disputedFigures` on the ticket routes — the same fact by three
 * routes, none of which anybody had written as a bug.
 *
 * All three were closed in the same change: the first and third into
 * scope-discriminated unions, the second refused outright at OWN scope
 * (403 `STORE_MONEY_NOT_FOR_ASSOCIATE` — 403 and not 404 because the
 * order exists and is theirs to follow; it is the FIGURE that is
 * refused). The list is kept rather than deleted because the next one
 * goes here: the fix for a finding is in a RESPONSE PROJECTION, never in
 * this file.
 */
const OPEN_LEAKS: readonly Decision[] = [];

/**
 * Declared on the type, and NEVER SENT to an associate — withheld by a
 * scope-discriminated union rather than by removing the field.
 *
 * ── WHY A THIRD LIST AND NOT ONE OF THE OTHER TWO ────────────────────
 * This sweep reads DECLARED types, which is its strength: it sees a
 * field populated on a path nobody exercised. It is also the one thing
 * it cannot see — WHICH ARM of a union ships. `StoreOrderLineView.cost`
 * is `{visible: true, transferPriceInr, …} | {visible: false}`, so
 * `transferPriceInr` is genuinely reachable from the return type and the
 * sweep is right to flag it; at OWN scope the value is the empty arm.
 *
 * Calling that an OPEN LEAK would be false — it is closed, and the
 * worklist would never empty. Calling it DELIBERATELY VISIBLE would be
 * worse: it is not visible, and that list means "safe for an associate
 * to READ", which would quietly become the precedent for a field that
 * really is sent.
 *
 * ── THE ENTRY IS ONLY HONEST IF SOMETHING PROVES IT ──────────────────
 * A type-level sweep cannot prove absence on the wire, so every entry
 * here NAMES the e2e that does, and a test below fails if that file does
 * not exist. Without that, this list is the hole: anybody could move an
 * inconvenient finding into it and the gate would go green.
 */
interface WithheldDecision extends Decision {
  /** The spec that asserts, against a real database, that it is absent. */
  readonly provenBy: string;
}

const WITHHELD_BY_SCOPE: readonly WithheldDecision[] = [
  {
    routes: [
      'POST /store/orders',
      'GET /store/orders/:id',
      'POST /store/orders/:id/cancel',
      'PATCH /store/orders/:orderId/recipient',
    ],
    fields: ['transferInr', 'transferPriceInr', 'minRetailInr', 'maxRetailInr'],
    why: 'Moved into `StoreOrderLineView.cost` / `totals.cost` on 2026-10-08 — discriminated unions on the caller’s scope. At OWN the value is `{visible: false}` and carries none of these; a reader must narrow on `visible` first, so a cost field added to the other arm later is unreachable at associate scope by the TYPE SYSTEM rather than by somebody remembering a filter. The arm itself stays because an ALL-scope store user is reading their own cost, which is theirs.',
    provenBy: 'test/e2e/associate-scope.e2e-spec.ts',
  },
  {
    routes: [
      'GET /store/tickets',
      'GET /store/tickets/:ticketId',
      'POST /store/tickets',
      'POST /store/issues',
    ],
    fields: ['transferTotalInr', 'transferInr', 'netInr', 'codFeeShareInr', 'instantFeeShareInr'],
    why: 'RS-7’s `disputedFigures` became `StoreTicketView.figures: StoreDisputeFigures`, the same union. RENAMED rather than reshaped in place, so a consumer still reading the old key gets a type error instead of `undefined`. The withheld arm keeps the COD — what the customer owes is the associate’s business; the store-versus-seller settlement arithmetic is not.',
    provenBy: 'test/e2e/associate-scope.e2e-spec.ts',
  },
  {
    routes: ['GET /store/orders/:id/money'],
    fields: [
      'transferTotalInr',
      'storeNetInr',
      'sellerNetInr',
      'netInr',
      'transferInr',
      'codFeeShareInr',
      'instantFeeShareInr',
      'creditedAt',
    ],
    why: 'The route is refused outright at OWN scope — 403 `STORE_MONEY_NOT_FOR_ASSOCIATE`. Not narrowed field by field, which would have left a screen of blanks, and 403 rather than 404 because the order exists and is theirs to follow; it is the FIGURE that is refused. The handler still declares the full view because an ALL-scope caller gets all of it.',
    provenBy: 'test/e2e/associate-scope.e2e-spec.ts',
  },
];

// ─────────────────────────────────────────────────────────────────────
// The sweep.
// ─────────────────────────────────────────────────────────────────────

/** Source with every comment removed. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function filesUnder(dir: string, suffix: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) filesUnder(full, suffix, out);
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

const ALL_TS = filesUnder(SRC, '.ts');

/** Index of the character after the `}` matching the `{` at `open`. */
function afterMatchingBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return src.length;
}

/**
 * Every `interface` and `type` declaration in the API, by name.
 *
 * Resolved by NAME across the whole source rather than by import, which
 * can pull in an unrelated same-named type — over-inclusion, which is the
 * safe direction here and has an escape hatch.
 */
const DECLARATIONS = ((): ReadonlyMap<string, readonly string[]> => {
  const map = new Map<string, string[]>();
  const push = (name: string, body: string): void => {
    const existing = map.get(name);
    if (existing === undefined) map.set(name, [body]);
    else existing.push(body);
  };
  for (const file of ALL_TS) {
    const src = code(file);
    for (const m of src.matchAll(/\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*\{/g)) {
      const open = src.indexOf('{', m.index + m[0].length - 1);
      push(m[1] ?? '', src.slice(m.index, afterMatchingBrace(src, open)));
    }
    for (const m of src.matchAll(/\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g)) {
      let i = m.index + m[0].length;
      let depth = 0;
      while (i < src.length) {
        const c = src[i] ?? '';
        if ('{([<'.includes(c)) depth += 1;
        else if ('})]>'.includes(c)) depth -= 1;
        else if (c === ';' && depth <= 0) break;
        i += 1;
      }
      push(m[1] ?? '', src.slice(m.index, i));
    }
  }
  return map;
})();

/** Type names that carry no fields of their own. */
const STRUCTURAL = new Set([
  'Promise',
  'Readonly',
  'ReadonlyArray',
  'Record',
  'Array',
  'Partial',
  'Required',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'ReturnType',
  'Awaited',
  'Map',
  'Set',
  'Date',
  'Buffer',
  'String',
  'Number',
  'Boolean',
  'Object',
  'StreamableFile',
  'Response',
  'Request',
]);

function declaredMembers(body: string): string[] {
  return [...body.matchAll(/(?:^|[\s{;,(])(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/gm)].map(
    (m) => m[1] ?? '',
  );
}

function referencedTypes(body: string): string[] {
  return [...body.matchAll(/\b([A-Z][A-Za-z0-9_$]*)\b/g)]
    .map((m) => m[1] ?? '')
    .filter((n) => !STRUCTURAL.has(n));
}

/** Every field name reachable from a declared response type. */
function fieldsOf(typeText: string): ReadonlySet<string> {
  const fields = new Set<string>();
  const visited = new Set<string>();
  const queue: string[] = [typeText];
  while (queue.length > 0) {
    const body = queue.shift() ?? '';
    for (const f of declaredMembers(body)) fields.add(f);
    for (const ref of referencedTypes(body)) {
      if (visited.has(ref)) continue;
      visited.add(ref);
      for (const decl of DECLARATIONS.get(ref) ?? []) queue.push(decl);
    }
  }
  return fields;
}

/** The declared return type of `ClassName.method`, from its source. */
function methodReturnType(className: string, method: string): string | null {
  for (const file of ALL_TS) {
    const src = code(file);
    if (!new RegExp(String.raw`\bclass\s+${className}\b`).test(src)) continue;
    const head = new RegExp(
      String.raw`\n  (?:(?:public|private|protected|readonly|static|async)\s+)*${method}\s*\(`,
    ).exec(src);
    if (head === null) continue;
    let i = src.indexOf('(', head.index + head[0].length - 1);
    let depth = 0;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return /^\s*:\s*([\s\S]*?)\s*\{/.exec(src.slice(i + 1))?.[1] ?? null;
  }
  return null;
}

interface Reachable {
  readonly route: string;
  readonly permissions: readonly string[];
  readonly returnType: string;
  /** False when a `ReturnType<Service['x']>` could not be followed. */
  readonly resolved: boolean;
}

const ASSOCIATE_PERMISSIONS: readonly string[] =
  DEFAULT_STORE_ROLES.find((r) => r.key === 'associate')?.permissions ?? [];

const HTTP_DECORATOR = String.raw`@(Get|Post|Patch|Put|Delete)\(`;

function reachableRoutes(): readonly Reachable[] {
  const associate = new Set<string>(ASSOCIATE_PERMISSIONS);
  const out: Reachable[] = [];
  for (const file of filesUnder(join(SRC, 'modules'), '.controller.ts')) {
    const src = code(file);
    if (!src.includes('StoreJwtGuard')) continue;
    const base = /@Controller\(\s*'([^']*)'/.exec(src)?.[1] ?? '';
    // A whole controller marked self-service is reachable by ANY signed-in
    // store user, an associate included — the guard short-circuits its
    // permission gate entirely, so these must be swept too.
    const selfService = /@StoreSelfService\(\)/.test(src);
    const classPermissions = /\n@RequireStorePermissions\(([^)]*)\)/.exec(src)?.[1];
    for (const block of src.split(new RegExp(String.raw`\n  (?=${HTTP_DECORATOR})`)).slice(1)) {
      const head = new RegExp(String.raw`^@(Get|Post|Patch|Put|Delete)\(\s*'?([^')]*)'?`).exec(
        block,
      );
      const signature = /\n {2}(?:async )?\w+\(([\s\S]*)/.exec(block);
      if (head === null || signature === null) continue;
      // HANDLER OVERRIDES CLASS — the decorator's own rule. Merging them
      // would make this sweep think a handler needs more than it does
      // and quietly drop it from the associate's reach.
      const own = /\n {2}@RequireStorePermissions\(([^)]*)\)/.exec(block)?.[1];
      const raw = own ?? classPermissions;
      const permissions = selfService
        ? ['<self-service>']
        : [...(raw ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
      if (!selfService && !permissions.some((p) => associate.has(p))) continue;

      const declared = (/\)\s*:\s*([\s\S]*?)\s*\{\n/.exec(signature[1] ?? '')?.[1] ?? 'void')
        .replace(/\s+/g, ' ')
        .trim();
      const indirect = /^ReturnType<\s*([A-Za-z_$][\w$]*)\['([^']+)'\]\s*>$/.exec(declared);
      const followed =
        indirect === null ? declared : methodReturnType(indirect[1] ?? '', indirect[2] ?? '');
      out.push({
        route: `${(head[1] ?? '').toUpperCase()} /${[base, head[2]].filter(Boolean).join('/')}`,
        permissions,
        returnType: followed ?? declared,
        resolved: indirect === null || followed !== null,
      });
    }
  }
  return out;
}

const REACHABLE = reachableRoutes();

/** Every flagged `METHOD /path :: field` the sweep can see. */
const FLAGGED: readonly string[] = [
  ...new Set(
    REACHABLE.flatMap((r) =>
      [...fieldsOf(r.returnType)]
        .filter((f) => STORE_COST_OR_EARNINGS.test(f))
        .map((f) => `${r.route} :: ${f}`),
    ),
  ),
].sort();

function flatten(decisions: readonly Decision[]): ReadonlySet<string> {
  return new Set(
    decisions.flatMap((d) => d.routes.flatMap((r) => d.fields.map((f) => `${r} :: ${f}`))),
  );
}

const VISIBLE = flatten(DELIBERATELY_VISIBLE);
const LEAKS = flatten(OPEN_LEAKS);
const WITHHELD = flatten(WITHHELD_BY_SCOPE);

describe('the sweep this spec depends on', () => {
  it('derives the associate’s permissions from the role itself', () => {
    // Not a hand-copied list: a permission added to the role widens the
    // sweep with no edit here. If the role vanished, every assertion
    // below would pass against an empty reach — this is that tripwire.
    expect(ASSOCIATE_PERMISSIONS.length).toBeGreaterThanOrEqual(8);
    expect(ASSOCIATE_PERMISSIONS).toContain('orders.view');
    expect(ASSOCIATE_PERMISSIONS).not.toContain('catalogue.view');
    expect(ASSOCIATE_PERMISSIONS).not.toContain('terms.view');
    expect(ASSOCIATE_PERMISSIONS).not.toContain('reports.view');
    expect(ASSOCIATE_PERMISSIONS.filter((p) => p.startsWith('wallet.'))).toEqual([]);
  });

  it('found a plausible number of associate-reachable routes', () => {
    // A parser that stops matching returns an empty list, and an empty
    // list passes every "nothing is unaccounted for" check perfectly.
    expect(REACHABLE.length).toBeGreaterThan(30);
  });

  it('read the response types rather than skipping them', () => {
    // A `ReturnType<Service['method']>` the sweep cannot follow walks
    // through looking clean, because there is nothing to look at. A
    // silent skip is exactly the failure this file exists to prevent.
    expect(REACHABLE.filter((r) => !r.resolved).map((r) => r.route)).toEqual([]);
    // And the type graph really resolves: this one is deep (a list of a
    // view of lines) and would be empty if the walker were broken.
    expect([...fieldsOf('Promise<StoreOrderView>')]).toContain('transferPriceInr');
  });

  it('the vocabulary matches the things it is named for', () => {
    // A regex edited into uselessness clears every route at once.
    for (const name of [
      'transferPriceInr',
      'transferTotalInr',
      'unitCostInr',
      'storeNetInr',
      'marginInr',
      'codFeeShareInr',
      'hiddenPercent',
      'setAsideQty',
      'walletManagedBy',
    ]) {
      expect(STORE_COST_OR_EARNINGS.test(name)).toBe(true);
    }
    // And is not simply true of everything.
    for (const name of ['orderNumber', 'recipientName', 'status', 'quantity', 'retailUnitInr']) {
      expect(STORE_COST_OR_EARNINGS.test(name)).toBe(false);
    }
  });
});

describe('every store-cost field an associate can reach is decided', () => {
  it('nothing is unaccounted for', () => {
    // The failure message IS the instruction: each line is a figure about
    // what the store pays or earns, on a response an associate can ask
    // for, with nobody having decided that they may see it.
    const undecided = FLAGGED.filter((f) => !VISIBLE.has(f) && !LEAKS.has(f) && !WITHHELD.has(f));
    expect(undecided).toEqual([]);
  });

  it('every DELIBERATELY_VISIBLE entry names a field the sweep really sees', () => {
    // A stale allow-list entry is not an error and not a warning — it is
    // a line that reads as a decision and guards nothing, which is the
    // precise defect `impersonation-deny-list.spec.ts` was written for.
    // Deliberately NOT asserted of OPEN_LEAKS: a stale entry there means
    // somebody CLOSED one, which is good news, not drift.
    const seen = new Set(FLAGGED);
    expect([...VISIBLE].filter((f) => !seen.has(f))).toEqual([]);
  });

  it('every WITHHELD_BY_SCOPE entry names a spec that EXISTS and asserts absence', () => {
    /*
      This list is the one that could swallow the gate: an inconvenient
      finding moved here goes green on a sentence. The sentence is not
      enough — a type-level sweep cannot prove what ships, so each entry
      names the e2e that can, and that file has to be real and has to
      mention the route it claims to cover.

      It does NOT re-prove the absence (that needs a database, which the
      unit suite has not got). It proves the PROOF exists, which is the
      part somebody skipping the work would skip.
    */
    for (const d of WITHHELD_BY_SCOPE) {
      const file = join(API_ROOT, d.provenBy);
      expect(existsSync(file)).toBe(true);
      const spec = readFileSync(file, 'utf8');
      for (const route of d.routes) {
        // The path without its method and its `:params` — what a
        // supertest call actually spells.
        const path = route.replace(/^[A-Z]+ /, '').replace(/\/:[A-Za-z]+/g, '/');
        const stem = path.split('/').filter(Boolean).slice(0, 2).join('/');
        expect(spec).toContain(stem);
      }
      expect(d.why.length).toBeGreaterThan(80);
    }
  });

  it('a field is never on two lists at once', () => {
    // Withheld AND deliberately visible is a contradiction; withheld AND
    // open is somebody closing a leak without deleting its entry.
    expect([...WITHHELD].filter((f) => VISIBLE.has(f) || LEAKS.has(f))).toEqual([]);
  });

  it('a route is never on both lists', () => {
    // The two disagreeing is how a field reads as safe in one place and
    // as a known hole in the other.
    expect([...VISIBLE].filter((f) => LEAKS.has(f))).toEqual([]);
  });
});

/*
  THE `it.failing` WORKLIST BLOCK THAT STOOD HERE IS DELETED, ON PURPOSE.

  It was written green-while-open / red-when-closed, so that the day the
  last leak was closed it would go red and whoever closed it would delete
  both the entry and the block. That happened on 2026-10-08: all three
  findings were closed in one change, `OPEN_LEAKS` emptied, and this is
  the deletion it asked for.

  It is recorded rather than silently removed because the shape is worth
  reusing and is easy to mistake for dead scaffolding: a gate that is RED
  for a known, named, documented reason is a gate people learn to ignore,
  and the sweep above it — which catches something NEW — would be ignored
  with it. If a finding is ever added back to `OPEN_LEAKS`, bring this
  block back with it; an empty list guarded by nothing is a list that can
  quietly grow.
*/
