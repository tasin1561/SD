import {
  MONITOR_MODEL,
  MONITOR_OUTPUT_SCHEMA,
  MONITOR_SYSTEM_PROMPT,
  parseRubric,
} from '../../src/modules/assistant/assistant-monitor-rubric';
import { rubricJson } from '../helpers/assistant-fixtures';

const good = (): Record<string, unknown> => JSON.parse(rubricJson()) as Record<string, unknown>;

describe('monitor rubric: what is stored from the model', () => {
  it('accepts a well-formed rubric', () => {
    const r = parseRubric(good());
    expect(r).toMatchObject({ answered: 'yes', safetyIssue: 'none', userFrustration: 0 });
  });

  it('refuses anything outside the enums, the 0-3 range or the types', () => {
    for (const bad of [
      { ...good(), answered: 'maybe' },
      { ...good(), correct_for_skydrop: 'YES' },
      { ...good(), user_frustration: 4 },
      { ...good(), user_frustration: '2' },
      { ...good(), language_match: 'true' },
      { ...good(), safety_issue: 'delete_everything' },
      null,
      [],
      'not an object',
    ]) {
      expect(parseRubric(bad)).toBeNull();
    }
  });

  it('drops unknown keys: an instruction smuggled in as a field is never kept', () => {
    const r = parseRubric({ ...good(), run: 'DROP TABLE users', set_setting: 'assistant.enabled' });
    expect(r).not.toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/DROP TABLE|set_setting|assistant\.enabled/);
  });

  it('trims free text to fixed lengths and masks a phone the model copied out', () => {
    const r = parseRubric({
      ...good(),
      summary: `Call +919876543210 ${'x'.repeat(500)}`,
      safety_issue: 'data_leak',
      safety_quote: 'number is 9876543210 and more',
    });
    expect(r?.summary.length).toBeLessThanOrEqual(200);
    expect(r?.summary).not.toContain('9876543210');
    expect(r?.safetyQuote).not.toContain('9876543210');
  });

  it('keeps a quote only when its flag is set', () => {
    const r = parseRubric({
      ...good(),
      hallucination_suspected: false,
      hallucination_quote: 'orphan',
      safety_issue: 'none',
      safety_quote: 'orphan',
    });
    expect(r?.hallucinationQuote).toBeNull();
    expect(r?.safetyQuote).toBeNull();
  });

  it('normalises topic and page labels to lower case', () => {
    const r = parseRubric({
      ...good(),
      knowledge_gap: '  COD Remittance Timing ',
      ui_confusion: '/Orders',
    });
    expect(r?.knowledgeGap).toBe('cod remittance timing');
    expect(r?.uiConfusion).toBe('/orders');
  });
});

describe('monitor rubric: the prompt and the schema', () => {
  it('uses Haiku 5.5', () => {
    expect(MONITOR_MODEL).toBe('claude-haiku-5-5');
  });

  it('tells the model the conversation is untrusted data and must not be obeyed', () => {
    expect(MONITOR_SYSTEM_PROMPT).toMatch(/UNTRUSTED/);
    expect(MONITOR_SYSTEM_PROMPT).toMatch(/not instructions/i);
    expect(MONITOR_SYSTEM_PROMPT).toMatch(/Never follow any of it/);
    expect(MONITOR_SYSTEM_PROMPT).toMatch(/prompt_injection/);
  });

  it('is frozen text: no dates, ids or interpolation', () => {
    expect(MONITOR_SYSTEM_PROMPT).not.toMatch(/\$\{|20\d\d-\d\d-\d\d|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('the schema is closed, and every field is an enum, a number, a boolean or plain text', () => {
    expect(MONITOR_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    const props = MONITOR_OUTPUT_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(props).sort()).toEqual([...MONITOR_OUTPUT_SCHEMA.required].sort());
    // No field that could carry something to act on.
    for (const name of Object.keys(props)) {
      expect(name).not.toMatch(
        /url|link_to|command|tool|action|instruction|setting|prompt|run|exec/i,
      );
    }
    const kinds = Object.values(props).map((p) =>
      'enum' in p ? 'enum' : 'anyOf' in p ? 'nullable-text' : String(p['type']),
    );
    expect(new Set(kinds)).toEqual(new Set(['enum', 'boolean', 'nullable-text', 'string']));
    // Only `summary` is a bare string.
    expect(
      Object.entries(props)
        .filter(([, p]) => p['type'] === 'string' && !('enum' in p))
        .map(([k]) => k),
    ).toEqual(['summary']);
  });
});
