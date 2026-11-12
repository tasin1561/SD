import { fakeRegistry, scope, staffScope, storeScope } from '../helpers/assistant-fixtures';
import { systemPromptFor } from '../../src/modules/assistant/assistant-system-prompt';
import { defaultKnowledge } from '../../src/modules/assistant/knowledge/knowledge-base';
import { MAX_TOOL_RESULT_CHARS } from '../../src/modules/assistant/services/assistant-tool-registry.service';
import type { CallerScope } from '../../src/modules/assistant/assistant.types';

const reg = fakeRegistry();
const run = (s: CallerScope, tool: string, input: unknown) => reg.execute(s, tool, input);
const kb = defaultKnowledge();

const assocScope = storeScope({
  audience: 'ASSOCIATE',
  orderScope: 'OWN',
  permissions: ['orders.view', 'catalogue.sell'],
});
const ALL: ReadonlyArray<readonly [string, CallerScope]> = [
  ['SELLER', scope()],
  ['STORE', storeScope()],
  ['ASSOCIATE', assocScope],
  ['STAFF', staffScope()],
];

describe('explain_error: input validation', () => {
  it.each([
    'lowercase_code',
    'AB',
    'A',
    'ORDER NOT FOUND',
    'ORDER-NOT-FOUND',
    "ORDER_NOT_FOUND'; DROP TABLE orders",
    '../../etc/passwd',
    '[ORDER_NOT_FOUND]',
    '9ORDER',
    '_ORDER',
  ])('rejects %j', async (code) => {
    const r = await run(scope(), 'explain_error', { code });
    expect(r.isError).toBe(true);
    expect(r.errorCode).toBe('INVALID_INPUT');
  });

  it('rejects unknown arguments and a missing code', async () => {
    expect(
      (await run(scope(), 'explain_error', { code: 'ORDER_NOT_FOUND', sellerId: 'x' })).isError,
    ).toBe(true);
    expect((await run(scope(), 'explain_error', {})).isError).toBe(true);
  });

  it('accepts a well-formed code', async () => {
    const r = await run(scope(), 'explain_error', { code: 'ORDER_NOT_FOUND' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toMatchObject({ found: true, code: 'ORDER_NOT_FOUND' });
  });

  it('the pattern is enforced by us but not sent to the API (strict schemas take a subset)', () => {
    const params = reg.toolParams(scope());
    const p = params.find((t) => t.name === 'explain_error')!;
    expect(JSON.stringify(p.input_schema)).not.toContain('pattern');
    const own = reg.all().find((t) => t.name === 'explain_error')!;
    expect(own.inputSchema.properties.code?.pattern).toBe('^[A-Z][A-Z0-9_]{2,}$');
  });
});

describe('explain_error: real data, by audience', () => {
  const staffOnlyCode = kb.errorCodes.find((r) => r[1] === 'treasury')![0];
  const packCode = 'PACK_VERIFICATION_REQUIRED';

  it('staff get the pack-bench code explained with its area, text and a guide', async () => {
    const r = JSON.parse((await run(staffScope(), 'explain_error', { code: packCode })).content);
    expect(r.found).toBe(true);
    expect(r.area).toBe('Warehouse · packing');
    expect(r.message).toContain('Pack this parcel at the bench');
    expect(r.guides[0].title).toContain('pack bench');
  });

  it.each(ALL.filter(([n]) => n !== 'STAFF'))(
    '%s cannot learn a warehouse or finance code',
    async (_n, s) => {
      for (const code of [packCode, staffOnlyCode]) {
        const r = JSON.parse((await run(s, 'explain_error', { code })).content);
        expect(r.found).toBe(false);
        expect(r.message).toBeUndefined();
        expect(r.area).toBeUndefined();
      }
    },
  );

  it.each(ALL)('%s never receives a source path or code snippet', async (_n, s) => {
    for (const code of [packCode, staffOnlyCode, 'ORDER_NOT_FOUND', 'TICKET_NOT_FOUND']) {
      const out = (await run(s, 'explain_error', { code })).content;
      expect(out).not.toMatch(/apps\/|packages\/|docs\/|\.tsx?\b|node_modules|\bat [\w.]+ \(/);
    }
  });
});

describe('find_page: relative routes of the caller’s own console, filtered by permission', () => {
  const pagesOf = {
    SELLER: kb.pages.seller,
    STORE: kb.pages.reseller,
    ASSOCIATE: kb.pages.associate,
    STAFF: kb.pages.admin,
  } as const;
  const QUERIES = [
    'orders',
    'wallet',
    'tickets',
    'products',
    'warehouse',
    'settings',
    'catalogue',
    'team',
    'treasury',
    'call',
    'inventory',
    'customers',
    'dashboard',
  ];

  it.each(ALL)('%s: every route is a single-slash path from its own console', async (name, s) => {
    const mine = new Set(pagesOf[name as keyof typeof pagesOf].map((p) => p[0]));
    const full = {
      ...s,
      permissions: [
        ...new Set(
          Object.values(pagesOf)
            .flat()
            .map((p) => p[2])
            .filter((x): x is string => x !== null),
        ),
      ],
    };
    let seen = 0;
    for (const q of QUERIES) {
      const out = JSON.parse((await run(full, 'find_page', { query: q })).content);
      for (const p of out.pages ?? []) {
        seen++;
        expect(p.route).toMatch(/^\/[^/\\\s]/);
        expect(p.route).not.toMatch(/[:\s<>]|\[/);
        expect(mine.has(p.route)).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it.each(ALL)('%s: with no permissions, never a route that needs one', async (name, s) => {
    const pages = pagesOf[name as keyof typeof pagesOf];
    const gated = new Set(pages.filter((p) => p[2] !== null).map((p) => p[0]));
    expect(gated.size).toBeGreaterThan(0);
    for (const [route, title] of pages) {
      const out = JSON.parse(
        (await run({ ...s, permissions: [] }, 'find_page', { query: `${title} ${route}` })).content,
      );
      for (const p of out.pages ?? []) expect(gated.has(p.route)).toBe(false);
    }
  });

  it('a client is never given an admin route, even asking for one by name', async () => {
    const admin = new Set(kb.pages.admin.map((p) => p[0]));
    const clientOnly = new Set(kb.pages.seller.map((p) => p[0]));
    const full = scope({
      permissions: kb.pages.admin.map((p) => p[2]).filter((x): x is string => x !== null),
    });
    for (const q of [
      'treasury',
      'settlements',
      'warehouse pack',
      'call center queue',
      'staff roles',
      'courier accounts',
    ]) {
      const out = JSON.parse((await run(full, 'find_page', { query: q })).content);
      for (const p of out.pages ?? []) {
        // a route that happens to exist in both consoles (/orders) is fine only if it is the client's own page
        expect(clientOnly.has(p.route)).toBe(true);
        void admin;
      }
    }
  });

  it('finds the right page for a plain question', async () => {
    const out = JSON.parse((await run(scope(), 'find_page', { query: 'orders' })).content);
    expect(out.pages.map((p: { route: string }) => p.route)).toContain('/orders');
  });
});

describe('every tool result stays small', () => {
  const QUERIES = [
    'order',
    'a b',
    'the',
    'warehouse',
    'wallet money withdraw',
    'failed delivery re-attempt return rto',
    'address check score',
    'pack box scan label',
    'courier manual placement',
    'consignment inbound stock',
    'call confirmation queue',
    'settlement remittance treasury',
    'ticket damaged',
    'cod',
    'awb',
    'permission page access',
    'setting',
    'invariant',
    'delhivery shiprocket',
    'orders orders orders orders',
  ];

  it.each(ALL)('%s: search_help results are capped, whatever the query', async (_n, s) => {
    for (const q of QUERIES) {
      const r = await run(s, 'search_help', { query: q });
      expect(r.isError).toBe(false);
      expect(r.content.length).toBeLessThanOrEqual(5000);
      expect(r.content.length).toBeLessThan(MAX_TOOL_RESULT_CHARS);
      expect(r.content).not.toContain('[truncated]');
      const out = JSON.parse(r.content);
      expect((out.results ?? []).length).toBeLessThanOrEqual(5);
    }
  });

  it.each(ALL)('%s: find_page and explain_error results are small', async (_n, s) => {
    for (const q of QUERIES) {
      expect((await run(s, 'find_page', { query: q })).content.length).toBeLessThan(1500);
    }
    for (const c of kb.errorCodes.slice(0, 200)) {
      expect((await run(s, 'explain_error', { code: c[0] })).content.length).toBeLessThan(1800);
    }
  });
});

describe('the system prompt drives the knowledge tools and the links', () => {
  const all = ['STAFF', 'SELLER', 'STORE', 'ASSOCIATE'] as const;

  it.each(all)(
    '%s: translate to English keywords, then answer in the user’s language and script',
    (a) => {
      const p = systemPromptFor(a);
      expect(p).toContain('plain English keywords');
      expect(p).toContain('search_help, explain_error or find_page');
      expect(p).toContain("person's own language and script");
    },
  );

  it.each(all)('%s: explain_error first when there is a last error or a pasted [CODE]', (a) => {
    const p = systemPromptFor(a);
    expect(p).toMatch(/last error[\s\S]*explain_error[\s\S]*FIRST/);
    expect(p).toContain('[PACK_VERIFICATION_REQUIRED]');
  });

  it.each(all)('%s: walk a stuck user step by step, and never guess', (a) => {
    const p = systemPromptFor(a);
    expect(p).toContain('one step at a time');
    expect(p).toContain('Never fill a gap with a guess');
    expect(p).toContain('suggest raising a support ticket');
  });

  it.each(all)('%s: links come from find_page only, as relative markdown links', (a) => {
    const p = systemPromptFor(a);
    expect(p).toContain('[Orders](/orders)');
    expect(p).toContain('find_page');
    expect(p).toContain('Never write a route that find_page did not return');
    expect(p).toMatch(/one link for each place/i);
    expect(p).toContain('single slash');
  });

  it('the prompt is still frozen: no dates, ids or per-request values', () => {
    for (const a of all) {
      const p = systemPromptFor(a);
      expect(p).not.toMatch(/\b20\d\d-\d\d-\d\d\b|[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(systemPromptFor(a)).toBe(p);
    }
  });

  it('the find_page tool description tells the model to write the route as a markdown link', () => {
    const t = reg.all().find((x) => x.name === 'find_page')!;
    expect(t.description).toContain('[Orders](/orders)');
    expect(t.description).toContain('Never write a route this tool did not return');
  });

  it('every audience is offered find_page and explain_error with no permission needed', () => {
    for (const [, s] of ALL) {
      const n = reg.toolsFor({ ...s, permissions: [] }).map((t) => t.name);
      expect(n).toEqual(expect.arrayContaining(['find_page', 'explain_error', 'search_help']));
    }
  });
});
