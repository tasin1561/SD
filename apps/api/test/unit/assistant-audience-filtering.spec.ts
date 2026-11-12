import { fakeRegistry, scope, staffScope, storeScope } from '../helpers/assistant-fixtures';

const names = (s: Parameters<ReturnType<typeof fakeRegistry>['toolsFor']>[0]): string[] =>
  fakeRegistry()
    .toolsFor(s)
    .map((t) => t.name);

describe('the tool list is filtered per request, by audience AND permission', () => {
  it('a seller is offered seller tools and search_help — never a staff or store tool', () => {
    const n = names(scope());
    expect(n).toEqual(
      expect.arrayContaining([
        'get_my_order',
        'list_my_recent_orders',
        'get_my_wallet_summary',
        'track_my_shipment',
        'search_help',
      ]),
    );
    expect(n).not.toContain('get_order');
    expect(n).not.toContain('get_ops_queue_counts');
    expect(n).not.toContain('get_my_store_order');
    expect(n).not.toContain('list_my_store_orders');
  });

  it('a store user is offered store tools — and no seller or staff tool', () => {
    const n = names(storeScope());
    expect(n).toEqual(['get_my_store_order', 'list_my_store_orders', 'search_help']);
    for (const seller of [
      'get_my_order',
      'list_my_recent_orders',
      'get_my_wallet_summary',
      'track_my_shipment',
    ]) {
      expect(n).not.toContain(seller);
    }
    expect(n).not.toContain('get_order');
  });

  it('an associate gets the store reads (scoped to OWN by the viewer) and nothing else', () => {
    const n = names(storeScope({ audience: 'ASSOCIATE', orderScope: 'OWN' }));
    expect(n).toEqual(['get_my_store_order', 'list_my_store_orders', 'search_help']);
  });

  it('staff are offered staff tools — and no seller or store tool', () => {
    const n = names(staffScope());
    expect(n).toEqual(['get_ops_queue_counts', 'get_order', 'search_help']);
  });

  it('a tool is withheld from a caller who lacks its permission key', () => {
    expect(names(scope({ permissions: ['orders.view'] }))).not.toContain('get_my_wallet_summary');
    expect(names(scope({ permissions: ['wallet.view'] }))).not.toContain('get_my_order');
    expect(names(staffScope({ permissions: ['orders.view'] }))).not.toContain(
      'get_ops_queue_counts',
    );
    expect(names(scope({ permissions: [] }))).toEqual(['search_help']);
  });

  it('the tools sent to the API are the filtered list, sorted, with the cache breakpoint on the last', () => {
    const reg = fakeRegistry();
    const params = reg.toolParams(scope());
    expect(params.map((p) => p.name)).toEqual(names(scope()));
    expect(params.map((p) => p.name)).toEqual([...params.map((p) => p.name)].sort());
    params.forEach((p, i) => {
      expect('cache_control' in p).toBe(i === params.length - 1);
    });
  });

  it('a tool not in the caller’s list cannot be run by name', async () => {
    const r = await fakeRegistry().execute(storeScope(), 'get_my_wallet_summary', {});
    expect(r.errorCode).toBe('FORBIDDEN');
  });
});
