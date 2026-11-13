import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  extractLinks,
  languageMatches,
  linkPresent,
  loadCases,
  pickSample,
  scoreAnswer,
  validateCases,
  type EvalCase,
} from '../../scripts/assistant-eval';

/**
 * The saved eval itself costs money and never runs in CI. What CI does run is
 * this: the case files are valid, the runner's scoring behaves, and `--dry`
 * (the mode that touches no network) works end to end.
 */
describe('assistant eval: case files', () => {
  const cases = loadCases();

  it('has about sixty cases, covering all five languages and every kind', () => {
    expect(cases.length).toBeGreaterThanOrEqual(55);
    expect(new Set(cases.map((c) => c.language))).toEqual(
      new Set(['en', 'bn', 'banglish', 'hi', 'hinglish']),
    );
    expect(new Set(cases.map((c) => c.kind))).toEqual(
      new Set(['language', 'where', 'error', 'refusal']),
    );
  });

  it('every case file is sound', () => {
    expect(validateCases(cases)).toEqual([]);
  });

  it('the validator catches a wrong-script question and a duplicate id', () => {
    const bad: EvalCase[] = [
      { id: 'a', audience: 'staff', language: 'bn', kind: 'language', question: 'English text' },
      { id: 'a', audience: 'staff', language: 'en', kind: 'where', question: 'Where?' },
    ];
    const problems = validateCases(bad).join('\n');
    expect(problems).toContain('not Bangla script');
    expect(problems).toContain('duplicate id');
    expect(problems).toContain('needs expectLinks');
  });

  it('--dry validates and exits 0 without a login or a network', () => {
    const out = execFileSync(
      process.execPath,
      [
        '-r',
        'ts-node/register/transpile-only',
        join(__dirname, '../../scripts/assistant-eval.ts'),
        '--dry',
      ],
      {
        env: {
          PATH: process.env.PATH ?? '',
          TS_NODE_PROJECT: join(__dirname, '../../tsconfig.json'),
        },
        encoding: 'utf8',
      },
    );
    expect(out).toContain('cases valid');
  });
});

describe('assistant eval: scoring', () => {
  it('finds links and matches a page by path or sub-path', () => {
    const links = extractLinks(
      'Go to [Adjustments](/inventory/adjustments?x=1) and [Orders](/orders).',
    );
    expect(links).toEqual(['/inventory/adjustments?x=1', '/orders']);
    expect(linkPresent(links, '/inventory/adjustments')).toBe(true);
    expect(linkPresent(links, '/inventory')).toBe(true);
    expect(linkPresent(links, '/inv')).toBe(false);
  });

  it('checks the script of the answer', () => {
    expect(languageMatches('bn', 'আপনি এখানে গিয়ে স্টক ঠিক করতে পারেন।')).toBe(true);
    expect(languageMatches('bn', 'Go to the adjustments page.')).toBe(false);
    expect(languageMatches('hi', 'आप यहाँ जाकर स्टॉक ठीक कर सकते हैं।')).toBe(true);
    expect(languageMatches('en', 'Go to the adjustments page.')).toBe(true);
    expect(languageMatches('en', 'আপনি এখানে যান')).toBe(false);
    expect(
      languageMatches(
        'banglish',
        'Ami bolchi, apni stock ekhane thik korte pareben, kivabe korbo ta dekhun.',
      ),
    ).toBe(true);
    expect(
      languageMatches(
        'hinglish',
        'Aap yahan jakar stock theek kar sakte hain, kaise karein dekhein.',
      ),
    ).toBe(true);
    expect(languageMatches('banglish', 'আপনি')).toBe(false);
  });

  it('fails an answer with a missing link, a forbidden word or a wrong language', () => {
    const c: EvalCase = {
      id: 'x',
      audience: 'staff',
      language: 'en',
      kind: 'where',
      question: 'Where?',
      expectLinks: ['/fx'],
      forbidden: ['sk-ant'],
    };
    expect(scoreAnswer(c, { text: 'See [FX](/fx).', links: ['/fx'] }).pass).toBe(true);
    expect(scoreAnswer(c, { text: 'Somewhere.', links: [] }).linksMissing).toEqual(['/fx']);
    expect(
      scoreAnswer(c, { text: 'key sk-ant-123 [FX](/fx)', links: ['/fx'] }).forbiddenHits,
    ).toEqual(['sk-ant']);
    expect(scoreAnswer(c, { text: '', links: [] }).pass).toBe(false);
  });

  it('a sample spreads across kinds and languages', () => {
    const all = loadCases();
    const picked = pickSample(all, 8);
    expect(picked).toHaveLength(8);
    expect(new Set(picked.map((c) => c.kind)).size).toBeGreaterThanOrEqual(3);
  });
});
