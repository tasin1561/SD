import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '../../src/modules/assistant');
const read = (rel: string): string => readFileSync(join(dir, rel), 'utf8');

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return e.name === 'generated' ? [] : walk(p);
    return p.endsWith('.ts') ? [p] : [];
  });
const all = walk(dir).map((p) => p.slice(dir.length + 1));

/** Every file that is part of the monitor. */
const MONITOR_FILES = all.filter((f) => /monitor/.test(f));

/**
 * The monitor reads conversations and writes ONLY its own tables. Nothing it
 * produces may reach the live assistant, its prompt, tools or knowledge,
 * and it must have no way to write them. Read from source, because a
 * behavioural test cannot see a write nobody thought of.
 */
describe('the monitor cannot change the live assistant', () => {
  it('finds the monitor files', () => {
    expect(MONITOR_FILES.length).toBeGreaterThanOrEqual(7);
  });

  it('no monitor file imports anything that builds the live prompt, tools, knowledge or chat', () => {
    const forbidden =
      /assistant-system-prompt|assistant-tool-registry|assistant-tools|assistant-chat\.service|assistant-history|assistant-help\.service|knowledge\/|assistant-conversation\.service|assistant-model-gateway|assistant-knowledge|assistant-recommendation|assistant-eval-gate/;
    for (const f of MONITOR_FILES) {
      const imports = read(f)
        .split('\n')
        .filter((l) => /^\s*(import|export)\b.*from\s+['"]/.test(l) || /^\s*from\s+['"]/.test(l));
      for (const l of imports)
        expect({ f, l, hit: forbidden.test(l) }).toEqual({ f, l, hit: false });
    }
  });

  it('no monitor file writes anything but the four monitor tables (and the audit log / system issue)', () => {
    const writes =
      /\.(assistant\w+|systemSetting|knowledge\w*|prompt\w*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g;
    const allowed = new Set([
      'assistantMonitorRun',
      'assistantMonitorResult',
      'assistantMonitorUsage',
      'assistantMonitorTheme',
    ]);
    for (const f of MONITOR_FILES) {
      for (const m of read(f).matchAll(writes)) {
        expect({ f, table: m[1], ok: allowed.has(m[1] ?? '') }).toEqual({
          f,
          table: m[1],
          ok: true,
        });
      }
    }
    for (const f of MONITOR_FILES) {
      expect(read(f)).not.toMatch(
        /\$executeRaw(Unsafe)?`[^`]*(INSERT|UPDATE|DELETE)[^`]*assistant_(?!monitor)/is,
      );
      expect(read(f)).not.toMatch(/settings\.updateValue|SystemSettingsService/);
    }
  });

  it('nothing outside the monitor reads a monitor table, except the panel that displays it and retention', () => {
    const readers = all.filter(
      (f) => !/monitor/.test(f) && /assistantMonitor\w+|assistant_monitor_/.test(read(f)),
    );
    expect(readers.sort()).toEqual(
      [
        'services/assistant-billing.service.ts', // the cost line
        'services/assistant-budget.service.ts', // the cap function (comment only; reads via the store)
        'services/assistant-eval-gate.service.ts', // writes its calls onto the monitor's budget line
        'services/assistant-recommendation.service.ts', // drafts from the themes; same budget line
        'services/assistant-retention.service.ts', // 180-day scrub
        'services/assistant-store.service.ts', // the monitor's spend sum
      ].sort(),
    );
  });

  it('the live request path never mentions the monitor', () => {
    for (const f of [
      'services/assistant-chat.service.ts',
      'assistant-history.ts',
      'assistant-system-prompt.ts',
      'services/assistant-tool-registry.service.ts',
      'services/assistant-help.service.ts',
      'tools/assistant-tools.ts',
    ]) {
      expect(read(f)).not.toMatch(/monitor/i);
    }
  });

  it('the Anthropic SDK is touched in exactly two places: the chat gateway and the batch gateway', () => {
    const users = all.filter(
      (f) => /from '@anthropic-ai\/sdk'/.test(read(f)) && !/\.d\.ts$/.test(f),
    );
    const value = users.filter((f) => /^import Anthropic from '@anthropic-ai\/sdk'/m.test(read(f)));
    expect(value.sort()).toEqual([
      'services/assistant-batch-gateway.ts',
      'services/assistant-model-gateway.ts',
    ]);
  });

  it('the monitor request carries no tools and nothing from the live system prompt', () => {
    const src = read('assistant-monitor-transcript.ts');
    expect(src).not.toMatch(/tools\s*:/);
    expect(src).not.toMatch(/tool_choice/);
  });
});
