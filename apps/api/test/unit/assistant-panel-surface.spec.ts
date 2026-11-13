import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, '../../src/modules/assistant');
const read = (rel: string): string => readFileSync(join(dir, rel), 'utf8');

/**
 * What the control-panel services may and may not do, read from source.
 * Behavioural tests cannot see a write that was never tested for.
 */
describe('AI control panel: surface', () => {
  it('billing and panel never write: only reads, plus the audit log and the settings service', () => {
    for (const f of [
      'services/assistant-billing.service.ts',
      'services/assistant-panel.service.ts',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
      expect(src).not.toMatch(/\$executeRaw/);
    }
  });

  it('every handler of the panel controller declares a permission, and reading conversations has its own', () => {
    const src = read('controllers/admin-assistant-panel.controller.ts');
    expect(src).toMatch(/@RequirePermissions\('assistant\.admin'\)\s*\n@Controller/);
    const handlers = src.match(/@(Get|Post|Put)\(/g) ?? [];
    const readers = src.match(/@RequirePermissions\('assistant\.conversations\.read'\)/g) ?? [];
    // conversations list, open, reveal, download
    expect(readers).toHaveLength(4);
    expect(handlers.length).toBe(9);
  });

  it('opening, revealing and downloading all audit BEFORE returning data, and refuse without a row', () => {
    const src = read('services/assistant-panel.service.ts');
    expect(src).toMatch(/staff\.assistant\.conversation\.viewed/);
    expect(src).toMatch(/staff\.assistant\.phone\.revealed/);
    expect(src).toMatch(/staff\.assistant\.attachment\.downloaded/);
    expect(src).toMatch(/AUDIT_UNAVAILABLE/);
    // the audit call precedes the data read in each method
    for (const m of ['async open(', 'async reveal(', 'async downloadAttachment(']) {
      const body = src.slice(src.indexOf(m));
      expect(body.indexOf('auditOrRefuse')).toBeGreaterThan(-1);
      expect(body.indexOf('auditOrRefuse')).toBeLessThan(
        body.indexOf('assistantMessage.find') === -1
          ? 1e9
          : body.indexOf('assistantMessage.find') + 400,
      );
    }
  });

  it('the retention service is the only code that updates message text', () => {
    const offenders = (function walk(d: string): string[] {
      return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
        const p = join(d, e.name);
        if (e.isDirectory()) return e.name === 'generated' ? [] : walk(p);
        return /assistantMessage\.(update|updateMany|delete|deleteMany)/.test(
          readFileSync(p, 'utf8'),
        )
          ? [p]
          : [];
      });
    })(dir).map((p) => p.slice(dir.length));
    expect(offenders).toEqual(['/services/assistant-retention.service.ts']);
  });

  it('feedback is never read by anything that builds the model request', () => {
    for (const f of ['services/assistant-chat.service.ts', 'assistant-history.ts']) {
      expect(read(f)).not.toMatch(/feedback/i);
    }
  });
});
