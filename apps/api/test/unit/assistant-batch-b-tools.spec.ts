import {
  SELLER_A,
  SELLER_B,
  STORE_1,
  fakeRegistry,
  scope,
  staffScope,
  storeScope,
  type FakeOrder,
} from '../helpers/assistant-fixtures';

/**
 * BATCH B — the new lookups, at the tool layer.
 *
 * The fakes apply the scope they are HANDED, the way each real service puts
 * it in a `where` clause, so what is proved here is that every tool hands
 * its service the CALLER's seller/store (from scope) and resolves the
 * typed number inside that scope — never anything the model said. The
 * services' own `where` clauses are pinned in
 * `assistant-batch-b-reads.spec.ts`, and against Postgres in
 * `assistant-batch-b.e2e-spec.ts`.
 */
const ORDERS: FakeOrder[] = [
  { sellerId: SELLER_A, orderNumber: 'SD-A-0001' },
  { sellerId: SELLER_B, orderNumber: 'SD-B-0002' },
];
const registry = fakeRegistry(ORDERS);
const SELLER_PERMS = [
  'orders.view',
  'wallet.view',
  'charges.view',
  'inventory.view',
  'inbound.view',
  'tickets.view',
];
const sellerA = (extra: string[] = []) => scope({ permissions: [...SELLER_PERMS, ...extra] });
const run = (s: ReturnType<typeof scope>, name: string, input: Record<string, unknown>) =>
  registry.execute(s, name, input);

describe('explain_my_order_charges', () => {
  it('control: a client reads the stored lines, the agreed currency and rate, and the wallet entries', async () => {
    const r = await run(sellerA(), 'explain_my_order_charges', { identifier: 'SD-A-0001' });
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.content) as {
      totalInr: string;
      lines: Array<{ agreed: { currency: string; fxRate: string } | null }>;
      walletEntries: unknown[];
    };
    expect(body.totalInr).toBe('191.87');
    expect(body.lines[0]?.agreed).toMatchObject({ currency: 'BDT', fxRate: '0.813' });
    expect(body.walletEntries).toHaveLength(1);
  });

  it("another client's order number is NOT_FOUND, byte-identical to one that does not exist", async () => {
    const foreign = await run(sellerA(), 'explain_my_order_charges', { identifier: 'SD-B-0002' });
    const ghost = await run(sellerA(), 'explain_my_order_charges', { identifier: 'SD-Z-9999' });
    expect(foreign.errorCode).toBe('NOT_FOUND');
    expect(foreign.content).toBe(ghost.content);
    expect(foreign.content).not.toContain('SD-B-0002');
  });

  it('never carries margin or the pricing context', async () => {
    const r = await run(sellerA(), 'explain_my_order_charges', { identifier: 'SD-A-0001' });
    expect(r.content).not.toMatch(/margin|computationContext|rateCard|sellerId/i);
  });

  it('a team member without wallet.view gets the charges but no wallet entries', async () => {
    const s = scope({ permissions: ['orders.view', 'charges.view'] });
    const r = await run(s, 'explain_my_order_charges', { identifier: 'SD-A-0001' });
    const body = JSON.parse(r.content) as { walletEntries: unknown; walletNote: string };
    expect(body.walletEntries).toBeNull();
    expect(body.walletNote).toContain('not shown');
  });

  it('is withheld without charges.view, and from store, associate and staff entirely', () => {
    const names = (s: Parameters<typeof registry.toolsFor>[0]): string[] =>
      registry.toolsFor(s).map((t) => t.name);
    expect(names(scope({ permissions: ['orders.view', 'wallet.view'] }))).not.toContain(
      'explain_my_order_charges',
    );
    const everything = [...SELLER_PERMS, 'tickets.manage', 'reports.view', 'callcenter.work'];
    expect(names(storeScope({ permissions: everything }))).not.toContain(
      'explain_my_order_charges',
    );
    expect(
      names(storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', permissions: everything })),
    ).not.toContain('explain_my_order_charges');
    expect(names(staffScope({ permissions: everything }))).not.toContain(
      'explain_my_order_charges',
    );
  });
});

describe('get_my_stock', () => {
  it('control + not found for an unknown or another client’s SKU', async () => {
    const ok = await run(sellerA(), 'get_my_stock', { sku: 'KURTA-BLUE-M' });
    expect(JSON.parse(ok.content)).toMatchObject({ qtyAvailable: 10, qtyInTransit: 30 });
    const other = await run(
      scope({ sellerId: SELLER_B, permissions: SELLER_PERMS }),
      'get_my_stock',
      {
        sku: 'KURTA-BLUE-M',
      },
    );
    const ghost = await run(sellerA(), 'get_my_stock', { sku: 'NOPE' });
    expect(other.errorCode).toBe('NOT_FOUND');
    expect(other.content).toBe(ghost.content);
  });

  it('needs inventory.view', async () => {
    const r = await run(scope({ permissions: ['orders.view'] }), 'get_my_stock', {
      sku: 'KURTA-BLUE-M',
    });
    expect(r.errorCode).toBe('FORBIDDEN');
  });
});

describe('get_my_consignment', () => {
  it('control, foreign and missing', async () => {
    const ok = await run(sellerA(), 'get_my_consignment', { number: 'CN-2026-000001' });
    expect(JSON.parse(ok.content)).toMatchObject({ status: 'IN_TRANSIT' });
    const foreign = await run(
      scope({ sellerId: SELLER_B, permissions: SELLER_PERMS }),
      'get_my_consignment',
      { number: 'CN-2026-000001' },
    );
    const ghost = await run(sellerA(), 'get_my_consignment', { number: 'CN-9999-999999' });
    expect(foreign.errorCode).toBe('NOT_FOUND');
    expect(foreign.content).toBe(ghost.content);
  });

  it('needs inbound.view', async () => {
    const r = await run(scope({ permissions: ['orders.view'] }), 'get_my_consignment', {
      number: 'CN-2026-000001',
    });
    expect(r.errorCode).toBe('FORBIDDEN');
  });
});

describe('get_failed_delivery_detail', () => {
  it('a client reads their own order’s attempts; another client’s order is NOT_FOUND', async () => {
    const ok = await run(sellerA(), 'get_failed_delivery_detail', { identifier: 'SD-A-0001' });
    expect(ok.isError).toBe(false);
    expect(ok.content).toContain('Customer not available');
    const foreign = await run(sellerA(), 'get_failed_delivery_detail', { identifier: 'SD-B-0002' });
    const ghost = await run(sellerA(), 'get_failed_delivery_detail', { identifier: 'SD-Z-9999' });
    expect(foreign.errorCode).toBe('NOT_FOUND');
    expect(foreign.content).toBe(ghost.content);
  });

  it('staff read any order with orders.view, and a staff caller without it is refused', async () => {
    const ok = await run(staffScope(), 'get_failed_delivery_detail', { identifier: 'SD-B-0002' });
    expect(ok.isError).toBe(false);
    const no = await run(
      staffScope({ permissions: ['callcenter.queue.view'] }),
      'get_failed_delivery_detail',
      {
        identifier: 'SD-B-0002',
      },
    );
    expect(no.errorCode).toBe('FORBIDDEN');
  });

  it('is not offered to a member store or an associate', () => {
    const n = registry
      .toolsFor(storeScope({ permissions: ['orders.view', 'tickets.view'] }))
      .map((t) => t.name);
    expect(n).not.toContain('get_failed_delivery_detail');
  });
});

describe('get_my_ticket', () => {
  it('a client reads their own ticket; a number that is another client’s is NOT_FOUND', async () => {
    const ok = await run(sellerA(), 'get_my_ticket', { number: 'TK-2026-000003' });
    expect(JSON.parse(ok.content)).toMatchObject({
      status: 'OPEN',
      lastStaffReplyAt: expect.any(String),
    });
    const foreign = await run(
      scope({ sellerId: SELLER_B, permissions: SELLER_PERMS }),
      'get_my_ticket',
      { number: 'TK-2026-000003' },
    );
    const ghost = await run(sellerA(), 'get_my_ticket', { number: 'TK-9999-999999' });
    expect(foreign.errorCode).toBe('NOT_FOUND');
    expect(foreign.content).toBe(ghost.content);
  });

  it('a store user and an associate reach the store half, in their own store only', async () => {
    for (const s of [
      storeScope({ permissions: ['tickets.view'] }),
      storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', permissions: ['tickets.view'] }),
    ]) {
      const ok = await run(s, 'get_my_ticket', { number: 'TK-2026-000009' });
      expect(ok.isError).toBe(false);
      expect(ok.content).not.toMatch(/resolutionAmount|figures|payer|claim|cost|margin/i);
    }
    const other = await run(
      storeScope({
        storeId: '0191a000-0000-7000-8000-0000000000d2',
        permissions: ['tickets.view'],
      }),
      'get_my_ticket',
      { number: 'TK-2026-000009' },
    );
    expect(other.errorCode).toBe('NOT_FOUND');
    expect(STORE_1).not.toBe('0191a000-0000-7000-8000-0000000000d2');
  });

  it('needs tickets.view', async () => {
    const r = await run(scope({ permissions: ['orders.view'] }), 'get_my_ticket', {
      number: 'TK-2026-000003',
    });
    expect(r.errorCode).toBe('FORBIDDEN');
  });
});

describe('staff helpers', () => {
  const callAgent = staffScope({ permissions: ['callcenter.work'] });

  it('explain_address_check: needs the call-centre key, explains the issues, never returns the address', async () => {
    const ok = await run(callAgent, 'explain_address_check', { identifier: 'SD-A-0001' });
    expect(ok.isError).toBe(false);
    expect(ok.content).toContain('MISSING_LANDMARK');
    expect(ok.content).not.toMatch(/completedAddress|extracted|addressLine|street/i);
    const refused = await run(
      staffScope({ permissions: ['orders.view'] }),
      'explain_address_check',
      {
        identifier: 'SD-A-0001',
      },
    );
    expect(refused.errorCode).toBe('FORBIDDEN');
    const missing = await run(callAgent, 'explain_address_check', { identifier: 'SD-Z-9999' });
    expect(missing.errorCode).toBe('NOT_FOUND');
  });

  it('draft_confirmation_call_script: call-centre staff only, facts only, no phone or street', async () => {
    const ok = await run(callAgent, 'draft_confirmation_call_script', {
      identifier: 'SD-A-0001',
      language: 'Hindi',
    });
    const body = JSON.parse(ok.content) as Record<string, unknown>;
    expect(body).toMatchObject({
      language: 'Hindi',
      customerName: 'Customer',
      codAmountInr: '999',
      items: [{ name: 'Blue kurta', quantity: 2, sku: 'SKU-1' }],
    });
    expect(ok.content).not.toMatch(/phone|email|address1|street/i);
    const refused = await run(
      staffScope({ permissions: ['orders.view'] }),
      'draft_confirmation_call_script',
      {
        identifier: 'SD-A-0001',
        language: 'English',
      },
    );
    expect(refused.errorCode).toBe('FORBIDDEN');
    const bad = await run(callAgent, 'draft_confirmation_call_script', {
      identifier: 'SD-A-0001',
      language: 'Klingon',
    });
    expect(bad.errorCode).toBe('INVALID_INPUT');
  });

  it('ops_metrics: reports.view only, validates its own enums and dates', async () => {
    const analyst = staffScope({ permissions: ['reports.view'] });
    const ok = await run(analyst, 'ops_metrics', {
      metric: 'orders_delivered',
      from: '2026-11-01',
      to: '2026-11-13',
      groupBy: 'none',
    });
    expect(JSON.parse(ok.content)).toMatchObject({ total: '14', metric: 'orders_delivered' });
    for (const bad of [
      { metric: 'drop_table', from: '2026-11-01', to: '2026-11-13', groupBy: 'none' },
      { metric: 'orders_created', from: '2026-11-01', to: '2026-11-13', groupBy: 'sellerId' },
      { metric: 'orders_created', from: 'yesterday', to: '2026-11-13', groupBy: 'none' },
      {
        metric: 'orders_created',
        from: '2026-11-01',
        to: '2026-11-13',
        groupBy: 'none',
        sellerId: SELLER_B,
      },
    ]) {
      expect((await run(analyst, 'ops_metrics', bad)).errorCode).toBe('INVALID_INPUT');
    }
    const refused = await run(staffScope({ permissions: ['orders.view'] }), 'ops_metrics', {
      metric: 'orders_created',
      from: '2026-11-01',
      to: '2026-11-13',
      groupBy: 'none',
    });
    expect(refused.errorCode).toBe('FORBIDDEN');
  });

  it('none of the staff helpers is offered to a client, store or associate', () => {
    const all = [...SELLER_PERMS, 'callcenter.work', 'reports.view', 'tickets.manage'];
    const staffOnly = ['explain_address_check', 'draft_confirmation_call_script', 'ops_metrics'];
    for (const s of [
      scope({ permissions: all }),
      storeScope({ permissions: all }),
      storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', permissions: all }),
    ]) {
      const n = registry.toolsFor(s).map((t) => t.name);
      for (const t of staffOnly) expect(n).not.toContain(t);
    }
  });
});

describe('associates and stores see none of the new cost-bearing tools', () => {
  it('with every permission, an associate is offered only the ticket lookup of Batch B', () => {
    const every = [...SELLER_PERMS, 'tickets.manage', 'reports.view', 'callcenter.work'];
    const n = registry
      .toolsFor(storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN', permissions: every }))
      .map((t) => t.name);
    for (const batchB of [
      'explain_my_order_charges',
      'get_my_stock',
      'get_my_consignment',
      'get_failed_delivery_detail',
      'explain_address_check',
      'draft_confirmation_call_script',
      'ops_metrics',
    ]) {
      expect(n).not.toContain(batchB);
    }
    expect(n).toContain('get_my_ticket');
  });
});
