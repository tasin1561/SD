import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssistantHelpService,
  HELP_SOURCES,
  parseMessageFile,
  parseSettingGuide,
} from '../../src/modules/assistant/services/assistant-help.service';
import {
  defaultKnowledge,
  type KnowledgeBase,
} from '../../src/modules/assistant/knowledge/knowledge-base';

/**
 * Staff-only knowledge must never come back for any other audience —
 * through search_help, explain_error OR find_page. Built on a small
 * hand-made knowledge base whose staff-only parts carry words that appear
 * nowhere else, so a hit proves which source it came from.
 */
const KB: KnowledgeBase = {
  guides: [
    {
      id: 'g-seller',
      audience: ['seller'],
      title: 'Sellerguide title',
      summary: 'sellerguidesummary',
      sections: [{ heading: 'Step', steps: ['Do the sellerguideword thing in the orders page.'] }],
      errorDomains: ['order'],
      sources: [],
    },
    {
      id: 'g-store',
      audience: ['store'],
      title: 'Storeguide title',
      summary: 'x',
      sections: [{ heading: 'Step', steps: ['Do the storeguideword thing in the catalogue.'] }],
      sources: [],
    },
    {
      id: 'g-assoc',
      audience: ['associate'],
      title: 'Assocguide title',
      summary: 'x',
      sections: [{ heading: 'Step', steps: ['Do the assocguideword thing for a customer.'] }],
      sources: [],
    },
    {
      id: 'g-staff',
      audience: ['staff'],
      title: 'Staffguide title',
      summary: 'x',
      sections: [
        { heading: 'Step', steps: ['Do the staffguideword thing at the treasury bench.'] },
      ],
      errorDomains: ['treasury'],
      sources: [],
    },
  ],
  glossary: [
    { term: 'openterm', meaning: 'A term every audience may read about.', example: 'openexample.' },
    { term: 'staffterm', audience: ['staff'], meaning: 'Staffonlymeaning here.', example: 'x' },
  ],
  portalText: {
    admin: [
      ['x.help', 'To cancelstaffword an order open the orders page and press the button now.'],
    ],
    seller: [
      ['x.help', 'To cancelsellerword an order open the orders page and press the button now.'],
    ],
    reseller: [
      ['x.help', 'To cancelstoreword an order open the orders page and press the button now.'],
    ],
    associate: [
      ['x.help', 'To cancelassocword an order open the orders page and press the button now.'],
    ],
  },
  settings: [
    ['ops.secret_thing', 'Narwhal switch — Controls the narwhal behaviour of the warehouse.'],
  ],
  internalDocs: [
    ['internal', 'The quokka invariant: an internal design rule only staff may read about.'],
  ],
  errorCodes: [
    ['SELLER_THING', 'order', 'Your order is missing something.'],
    ['STAFF_THING', 'treasury', 'Treasury secret wording.'],
    ['MIXED_THING', 'order,treasury', 'Shared wording.'],
  ],
  pages: {
    admin: [
      ['/orders', 'Orders', 'orders.view'],
      ['/treasury', 'Treasury', 'money.treasury.view'],
      ['/orders/[id]', 'Orders (detail)', 'orders.view'],
    ],
    seller: [
      ['/orders', 'Orders', 'orders.view'],
      ['/wallet', 'Wallet', 'wallet.view'],
      ['/dashboard', 'Dashboard', null],
    ],
    reseller: [['/catalogue', 'Catalogue', 'catalogue.view']],
    associate: [['/catalogue', 'What I sell', 'catalogue.sell']],
  },
};

const NON_STAFF = ['SELLER', 'STORE', 'ASSOCIATE'] as const;

describe('search_help is scoped to the audience’s own sources', () => {
  const svc = new AssistantHelpService().useKnowledge(KB);

  it('staff reach every source, including other audiences’ guides', () => {
    expect(svc.search('STAFF', 'cancelstaffword')[0]?.source).toBe('portal-text');
    expect(svc.search('STAFF', 'narwhal')[0]?.source).toBe('setting-guide');
    expect(svc.search('STAFF', 'quokka')[0]?.source).toBe('internal-docs');
    expect(svc.search('STAFF', 'staffguideword')[0]?.source).toBe('guide');
    expect(svc.search('STAFF', 'staffterm')[0]?.source).toBe('glossary');
    expect(svc.search('STAFF', 'sellerguideword')[0]?.source).toBe('guide');
  });

  it.each(NON_STAFF)('%s never gets staff-only content, however it is asked', (aud) => {
    for (const q of [
      'narwhal',
      'quokka invariant',
      'cancelstaffword',
      'internal design rule',
      'staffguideword',
      'staffterm staffonlymeaning',
      'treasury bench',
      'warehouse',
    ]) {
      for (const h of svc.search(aud, q)) {
        expect(['guide', 'glossary', 'portal-text']).toContain(h.source);
        expect(JSON.stringify(h)).not.toMatch(
          /narwhal|quokka|cancelstaffword|staffguideword|Staffonly/,
        );
      }
    }
  });

  it('each audience reaches only its own console’s text and its own guides', () => {
    expect(svc.search('SELLER', 'cancelsellerword').length).toBe(1);
    expect(svc.search('SELLER', 'cancelstoreword').length).toBe(0);
    expect(svc.search('SELLER', 'storeguideword').length).toBe(0);
    expect(svc.search('SELLER', 'sellerguideword')[0]?.source).toBe('guide');
    expect(svc.search('STORE', 'cancelstoreword').length).toBe(1);
    expect(svc.search('STORE', 'cancelsellerword').length).toBe(0);
    expect(svc.search('STORE', 'sellerguideword').length).toBe(0);
    expect(svc.search('ASSOCIATE', 'cancelassocword').length).toBe(1);
    expect(svc.search('ASSOCIATE', 'cancelstoreword').length).toBe(0);
    expect(svc.search('ASSOCIATE', 'storeguideword').length).toBe(0);
  });

  it('a glossary term marked staff-only is hidden from the others; an open one is shared', () => {
    for (const aud of NON_STAFF) {
      expect(svc.search(aud, 'staffterm').length).toBe(0);
      expect(svc.search(aud, 'openterm')[0]?.source).toBe('glossary');
    }
  });

  it('the source table grants the staff-only sources to STAFF alone', () => {
    for (const aud of NON_STAFF) {
      expect(HELP_SOURCES[aud].internalDocs).toBe(false);
      expect(HELP_SOURCES[aud].settingGuide).toBe(false);
      expect(HELP_SOURCES[aud].console).not.toBe('admin');
      expect(HELP_SOURCES[aud].guideAudience).not.toBe('staff');
    }
    expect(HELP_SOURCES.STAFF.internalDocs).toBe(true);
    expect(HELP_SOURCES.STAFF.console).toBe('admin');
  });
});

describe('explain_error never leaks staff-only areas or source paths', () => {
  const svc = new AssistantHelpService().useKnowledge(KB);
  const unknown = svc.explainError('SELLER', 'NO_SUCH_CODE_ANYWHERE');

  it('staff get a staff-area code explained, with its area and guide', () => {
    const r = svc.explainError('STAFF', 'STAFF_THING');
    expect(r).toMatchObject({
      found: true,
      area: 'Finance · treasury',
      message: 'Treasury secret wording.',
    });
    expect(r.guides?.[0]?.title).toBe('Staffguide title');
  });

  it.each(NON_STAFF)(
    '%s asking about a staff-area code looks exactly like an unknown code',
    (aud) => {
      const r = svc.explainError(aud, 'STAFF_THING');
      expect(r.found).toBe(false);
      expect({ ...r, code: '' }).toEqual({ ...unknown, code: '' });
      expect(JSON.stringify(r)).not.toMatch(/treasury|Treasury|Finance/);
    },
  );

  it('a code thrown from both areas is explained from the area the caller may see', () => {
    const r = svc.explainError('SELLER', 'MIXED_THING');
    expect(r).toMatchObject({ found: true, area: 'Orders' });
    expect(JSON.stringify(r)).not.toMatch(/treasury|Finance/i);
  });

  it('only guides the caller may read are offered with a code', () => {
    const r = svc.explainError('SELLER', 'SELLER_THING');
    expect(r.guides?.map((g) => g.title)).toEqual(['Sellerguide title']);
  });

  it('no result ever carries a source path or code', () => {
    for (const aud of ['STAFF', ...NON_STAFF] as const) {
      for (const code of ['SELLER_THING', 'STAFF_THING', 'MIXED_THING', 'NOPE']) {
        expect(JSON.stringify(svc.explainError(aud, code))).not.toMatch(
          /apps\/|packages\/|docs\/|\.tsx?\b|\bat .*:\d+/,
        );
      }
    }
  });
});

describe('find_page returns only routes of the caller’s own console they may open', () => {
  const svc = new AssistantHelpService().useKnowledge(KB);

  it('returns a page only when its permission is held', () => {
    expect(svc.findPage('SELLER', ['orders.view'], 'orders').map((p) => p.route)).toEqual([
      '/orders',
    ]);
    expect(svc.findPage('SELLER', [], 'orders')).toEqual([]);
    expect(svc.findPage('SELLER', ['orders.view'], 'wallet')).toEqual([]);
    expect(svc.findPage('SELLER', ['wallet.view'], 'wallet').map((p) => p.route)).toEqual([
      '/wallet',
    ]);
  });

  it('a page that needs no permission is open to everyone in that console', () => {
    expect(svc.findPage('SELLER', [], 'dashboard').map((p) => p.route)).toEqual(['/dashboard']);
  });

  it('never returns a staff page to a client, a store or an associate', () => {
    for (const aud of NON_STAFF) {
      expect(svc.findPage(aud, ['money.treasury.view', 'orders.view'], 'treasury')).toEqual([]);
    }
  });

  it('staff without the money permission are not given the treasury link', () => {
    expect(svc.findPage('STAFF', ['orders.view'], 'treasury')).toEqual([]);
    expect(svc.findPage('STAFF', ['money.treasury.view'], 'treasury').map((p) => p.route)).toEqual([
      '/treasury',
    ]);
  });

  it('never offers a detail page (it needs an id)', () => {
    expect(
      svc.findPage('STAFF', ['orders.view'], 'orders detail').every((p) => !p.route.includes('[')),
    ).toBe(true);
  });

  it('every associate/store route comes from that console, not from the client console', () => {
    expect(svc.findPage('ASSOCIATE', ['catalogue.sell'], 'catalogue')).toEqual([
      { route: '/catalogue', title: 'What I sell' },
    ]);
    expect(svc.findPage('ASSOCIATE', ['catalogue.view'], 'catalogue')).toEqual([]);
  });
});

describe('against the real repository knowledge', () => {
  const svc = new AssistantHelpService();
  const kb = defaultKnowledge();

  it('the parsers still read the real catalogue and settings guide (not zero)', () => {
    const root = join(__dirname, '../../../..');
    const msgs = parseMessageFile(
      readFileSync(join(root, 'apps/associate/src/i18n/messages/orders.ts'), 'utf8'),
    );
    expect(msgs.length).toBeGreaterThan(20);
    expect(msgs.find((m) => m.key === 'orders.title')).toMatchObject({ en: 'My orders' });
    const guide = parseSettingGuide(
      readFileSync(join(root, 'apps/admin/src/lib/system-setting-guide.ts'), 'utf8'),
    );
    expect(guide.length).toBeGreaterThan(100);
    expect(guide.find((g) => g.key === 'assistant.enabled')?.text).toContain('kill switch');
  });

  it('the committed knowledge is not empty', () => {
    expect(kb.errorCodes.length).toBeGreaterThan(700);
    expect(kb.glossary.length).toBeGreaterThanOrEqual(40);
    for (const c of ['admin', 'seller', 'reseller', 'associate'] as const) {
      expect(kb.pages[c].length).toBeGreaterThan(5);
      expect(kb.portalText[c].length).toBeGreaterThan(20);
    }
  });

  it('a client’s search for an internal-doc rule or a setting finds no staff source', () => {
    for (const q of [
      'wallet ledger invariant WAL',
      'system setting guide automatic withdrawals',
      'WMS-1 cross-module',
      'advisory lock saga',
    ]) {
      for (const aud of NON_STAFF) {
        for (const h of svc.search(aud, q)) {
          expect(['guide', 'glossary', 'portal-text']).toContain(h.source);
        }
      }
    }
  });

  it('staff do reach the internal docs and the settings guide', () => {
    expect(svc.search('STAFF', 'courier invariants Delhivery AWB dispatch').length).toBeGreaterThan(
      0,
    );
    expect(
      svc.search('STAFF', 'kill switch assistant').some((h) => h.source === 'setting-guide'),
    ).toBe(true);
    expect(
      svc.search('STAFF', 'saga advisory lock').some((h) => h.source === 'internal-docs'),
    ).toBe(true);
  });

  it('a client gets a workflow guide for a real question', () => {
    const hits = svc.search('SELLER', 'withdraw wallet money');
    expect(hits[0]?.source).toBe('guide');
    expect(hits[0]?.title).toContain('Wallet');
  });

  it('a client-facing guide never reaches the wrong audience in the real data', () => {
    for (const aud of ['STORE', 'ASSOCIATE'] as const) {
      const titles = [
        'Creating an order (the order form and the address check)',
        'Wallet, COD and payouts',
      ];
      for (const q of ['create order address check score', 'wallet cod payouts withdraw']) {
        for (const h of svc.search(aud, q))
          expect(titles.some((t) => h.title.startsWith(t))).toBe(false);
      }
    }
  });
});
