import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AssistantHelpService,
  HELP_SOURCES,
  parseMessageFile,
  parseSettingGuide,
} from '../../src/modules/assistant/services/assistant-help.service';

/**
 * Staff-only content must never come back for any other audience. Built
 * on a throwaway checkout whose staff-only files carry words that appear
 * nowhere else, so a hit proves which source it came from.
 */
function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'assistant-help-'));
  const put = (rel: string, body: string): void => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  };
  const msg = (word: string): string =>
    `export const m = defineMessages({\n  'x.help': ['To ${word} an order open the orders page and press the button.', 'বাংলা ${word}'],\n});\n`;
  put('apps/seller/src/i18n/messages/orders.ts', msg('cancelsellerword'));
  put('apps/reseller/src/i18n/messages/orders.ts', msg('cancelstoreword'));
  put('apps/associate/src/i18n/messages/orders.ts', msg('cancelassocword'));
  put('apps/admin/src/i18n/messages/orders.ts', msg('cancelstaffword'));
  put(
    'apps/admin/src/lib/system-setting-guide.ts',
    `export const SETTING_GUIDE = {\n  'ops.secret_thing': {\n    name: 'Narwhal switch',\n    group: 'Orders',\n    what: 'Controls the narwhal behaviour of the warehouse in detail here.',\n    example: 'Set to narwhal.',\n  },\n};\n`,
  );
  put(
    'docs/invariants/internal.md',
    '# Internal\n\nThe quokka invariant: this paragraph is an internal design rule that only staff may ever read about.\n',
  );
  return root;
}

describe('search_help is scoped to the audience’s own sources', () => {
  const svc = new AssistantHelpService().useRoot(fixtureRoot());

  it('staff reach the staff catalogue, the settings guide and the internal docs', () => {
    expect(svc.search('STAFF', 'cancelstaffword')[0]?.source).toBe('portal-text');
    expect(svc.search('STAFF', 'narwhal')[0]?.source).toBe('setting-guide');
    expect(svc.search('STAFF', 'quokka')[0]?.source).toBe('internal-docs');
  });

  it.each(['SELLER', 'STORE', 'ASSOCIATE'] as const)(
    '%s never gets staff-only content, however it is asked',
    (aud) => {
      for (const q of [
        'narwhal',
        'quokka invariant',
        'cancelstaffword',
        'internal design rule',
        'warehouse',
      ]) {
        const hits = svc.search(aud, q);
        for (const h of hits) {
          expect(h.source).toBe('portal-text');
          expect(JSON.stringify(h)).not.toMatch(/narwhal|quokka|cancelstaffword/);
        }
      }
    },
  );

  it('each portal audience reaches only its own portal’s text', () => {
    expect(svc.search('SELLER', 'cancelsellerword').length).toBe(1);
    expect(svc.search('SELLER', 'cancelstoreword').length).toBe(0);
    expect(svc.search('STORE', 'cancelstoreword').length).toBe(1);
    expect(svc.search('STORE', 'cancelsellerword').length).toBe(0);
    expect(svc.search('ASSOCIATE', 'cancelassocword').length).toBe(1);
    expect(svc.search('ASSOCIATE', 'cancelstoreword').length).toBe(0);
  });

  it('the source table grants the staff-only sources to STAFF alone', () => {
    for (const aud of ['SELLER', 'STORE', 'ASSOCIATE'] as const) {
      expect(HELP_SOURCES[aud].internalDocs).toBe(false);
      expect(HELP_SOURCES[aud].settingGuide).toBe(false);
      expect(HELP_SOURCES[aud].messageDirs.every((d) => !d.includes('admin'))).toBe(true);
    }
    expect(HELP_SOURCES.STAFF.internalDocs).toBe(true);
  });
});

describe('against the real repository', () => {
  const svc = new AssistantHelpService();

  it('the parsers read the real catalogue and settings guide (not zero)', () => {
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

  it('a seller’s search for an internal-doc rule or a setting finds no staff source', () => {
    for (const q of [
      'wallet ledger invariant WAL',
      'system setting guide automatic withdrawals',
      'WMS-1 cross-module',
    ]) {
      for (const h of svc.search('SELLER', q)) expect(h.source).toBe('portal-text');
    }
  });

  it('staff do reach the internal docs in the real repository', () => {
    const hits = svc.search('STAFF', 'courier invariants Delhivery AWB dispatch');
    expect(hits.length).toBeGreaterThan(0);
    expect(
      svc.search('STAFF', 'kill switch assistant').some((h) => h.source === 'setting-guide'),
    ).toBe(true);
  });

  it('a seller gets real help from their own catalogue', () => {
    const hits = svc.search('SELLER', 'withdraw wallet money');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'portal-text')).toBe(true);
  });
});
