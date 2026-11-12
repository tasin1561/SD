import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY } from '../../src/modules/assistant/knowledge/glossary';
import { GUIDES } from '../../src/modules/assistant/knowledge/guides';
import { ERROR_CODES } from '../../src/modules/assistant/knowledge/generated/error-codes';

const root = join(__dirname, '../../../..');

describe('workflow guides: shape and citations', () => {
  it('there are guides for every audience', () => {
    for (const a of ['seller', 'store', 'associate', 'staff'] as const) {
      expect(GUIDES.filter((g) => g.audience.includes(a)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('ids are unique, and every guide has audience, body and at least one source', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    for (const g of GUIDES) {
      expect(g.audience.length).toBeGreaterThan(0);
      expect(g.sections.length).toBeGreaterThan(0);
      for (const s of g.sections) expect(s.steps.length).toBeGreaterThan(0);
      expect(g.sources.length).toBeGreaterThan(0);
    }
  });

  it.each(GUIDES.map((g) => [g.id, g.sources] as const))(
    'every source of %s exists (citations must not rot)',
    (_id, sources) => {
      const missing = sources.filter((s) => !existsSync(join(root, s)));
      expect(missing).toEqual([]);
    },
  );
});

/** Shapes that mean "internal". A client-facing guide may contain none. */
const INTERNAL_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['invariant id (CUR-9, WMS-1 ...)', /\b[A-Z]{2,5}-\d+[a-z]?\b/],
  ['error code or enum constant', /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/],
  ['snake_case identifier (table, column, setting key)', /\b[a-z]+(?:_[a-z0-9]+)+\b/],
  ['dotted setting or permission key', /\b(?:ops|pricing|courier|system)\.[a-z_]+\b/],
  ['repo path', /\b(?:apps|packages|docs)\/|\.tsx?\b/],
  [
    'internals vocabulary',
    /invariant|advisory lock|prisma|jwt|saga|hypertable|idempoten|webhook secret|ledger/i,
  ],
];

describe('client-facing guides carry nothing internal', () => {
  const clientGuides = GUIDES.filter((g) => !g.audience.includes('staff'));

  it('there are client-facing guides to check (a check over nothing passes everything)', () => {
    expect(clientGuides.length).toBeGreaterThanOrEqual(10);
  });

  it.each(clientGuides.map((g) => [g.id, g] as const))('%s', (_id, g) => {
    const text = JSON.stringify([g.title, g.summary, g.keywords ?? [], g.sections]);
    for (const [name, re] of INTERNAL_SHAPES) {
      const m = re.exec(text);
      if (m !== null) throw new Error(`${g.id} contains ${name}: "${m[0]}"`);
    }
  });

  it('the detector fires on an internal shape (guard against a vacuous test)', () => {
    expect(INTERNAL_SHAPES.some(([, re]) => re.test('see CUR-9 and PACK_NOT_AVAILABLE'))).toBe(
      true,
    );
    expect(INTERNAL_SHAPES.some(([, re]) => re.test('the seller_wallet table'))).toBe(true);
  });
});

describe('staff guides name only error codes that exist', () => {
  const known = new Set(ERROR_CODES.map((r) => r[0]));
  const staff = GUIDES.filter((g) => g.audience.includes('staff'));

  it.each(staff.map((g) => [g.id, g] as const))('%s', (_id, g) => {
    const text = JSON.stringify(g.sections);
    const tokens = text.match(/\b[A-Z]{3,}(?:_[A-Z0-9]+)+\b/g) ?? [];
    for (const t of tokens) expect([t, known.has(t)]).toEqual([t, true]);
  });

  it('every errorDomains prefix of every guide matches a real domain', () => {
    const domains = new Set(ERROR_CODES.flatMap((r) => r[1].split(',')));
    for (const g of GUIDES) {
      for (const p of g.errorDomains ?? []) {
        const ok = [...domains].some((d) => d === p || d.startsWith(`${p}-`));
        expect([g.id, p, ok]).toEqual([g.id, p, true]);
      }
    }
  });
});

describe('glossary', () => {
  it('has about forty terms, unique, each with a one-line meaning and an example', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(40);
    expect(new Set(GLOSSARY.map((t) => t.term.toLowerCase())).size).toBe(GLOSSARY.length);
    for (const t of GLOSSARY) {
      expect(t.meaning.length).toBeGreaterThan(10);
      expect(t.meaning).not.toContain('\n');
      expect(t.example.length).toBeGreaterThan(5);
    }
  });

  it('covers the terms the owner named', () => {
    const have = new Set(GLOSSARY.map((t) => t.term.toLowerCase()));
    for (const w of [
      'awb',
      'ndr',
      'rto',
      'cod',
      'manifest',
      'sort code',
      'consignment',
      'pick list',
      'pack box',
      'handover',
      're-attempt',
      'remittance',
      'wallet',
      'declared value',
      'collectable amount',
    ]) {
      expect([w, have.has(w)]).toEqual([w, true]);
    }
  });

  it('terms visible to clients carry nothing internal', () => {
    for (const t of GLOSSARY.filter(
      (x) => x.audience === undefined || !x.audience.includes('staff'),
    )) {
      const text = `${t.meaning} ${t.example}`;
      expect(text).not.toMatch(/\b[A-Z]{2,5}-\d+\b|\b[a-z]+_[a-z_]+\b|apps\/|docs\//);
    }
  });
});
